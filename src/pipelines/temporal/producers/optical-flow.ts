import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createLogger } from '../../../utils/logger.js';

export type SidecarSpawner = (binaryPath: string, args: string[]) => ChildProcess;

export interface FlowProducerOptions {
  binaryPath: string;
  spawner?: SidecarSpawner;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxConsecutiveFailures?: number;
}

const log = createLogger('flow-producer');

export class FlowProducer extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly binaryPath: string;
  private readonly spawner: SidecarSpawner;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxFailures: number;

  private currentBackoffMs: number;
  private consecutiveFailures = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private _disabled = false;

  constructor(opts: FlowProducerOptions) {
    super();
    this.binaryPath = opts.binaryPath;
    this.spawner = opts.spawner ?? ((bin, args) => nodeSpawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] }));
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.maxFailures = opts.maxConsecutiveFailures ?? 3;
    this.currentBackoffMs = this.initialBackoffMs;
  }

  get disabled(): boolean {
    return this._disabled;
  }

  async start(): Promise<void> {
    if (this._disabled || this.stopping) return;
    this.spawnChild();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  private spawnChild(): void {
    log.info('spawning sidecar', { binaryPath: this.binaryPath });
    const child = this.spawner(this.binaryPath, []);
    this.child = child;
    child.once('exit', (code, signal) => this.onExit(code, signal));
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) log.debug('sidecar stderr', { sidecar: line });
      }
    });
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.stopping) return;
    this.consecutiveFailures += 1;
    log.warn('sidecar exited', { code, signal, failures: this.consecutiveFailures });
    if (this.consecutiveFailures >= this.maxFailures) {
      this._disabled = true;
      log.error('sidecar permanently disabled after consecutive failures');
      this.emit('disabled');
      return;
    }
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnChild();
    }, delay);
  }
}
