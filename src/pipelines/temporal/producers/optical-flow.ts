import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Buffer as NodeBuffer } from 'node:buffer';
import { createLogger } from '../../../utils/logger.js';

export type SidecarSpawner = (binaryPath: string, args: string[]) => ChildProcess;

export interface FlowProducerOptions {
  binaryPath: string;
  spawner?: SidecarSpawner;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxConsecutiveFailures?: number;
  phashThreshold?: number;
}

const log = createLogger('flow-producer');

interface KeyframeLike {
  pngBytes: Buffer;
  phash: bigint;
  timestamp: number;
}

interface FrameSource {
  on(event: 'keyframe', listener: (kf: KeyframeLike) => void): unknown;
  off(event: 'keyframe', listener: (kf: KeyframeLike) => void): unknown;
}

export class FlowProducer extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly binaryPath: string;
  private readonly spawner: SidecarSpawner;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxFailures: number;
  private readonly phashThreshold: number;

  private currentBackoffMs: number;
  private consecutiveFailures = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private _disabled = false;
  private lastAcceptedHash: bigint | null = null;
  private frameSource: FrameSource | null = null;
  private readonly keyframeListener: (kf: KeyframeLike) => void;
  public framesAccepted = 0;
  public framesDropped = 0;

  constructor(opts: FlowProducerOptions) {
    super();
    this.binaryPath = opts.binaryPath;
    this.spawner = opts.spawner ?? ((bin, args) => nodeSpawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] }));
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.maxFailures = opts.maxConsecutiveFailures ?? 3;
    this.phashThreshold = opts.phashThreshold ?? 5;
    this.currentBackoffMs = this.initialBackoffMs;
    this.keyframeListener = (kf) => this.onKeyframe(kf);
  }

  get disabled(): boolean {
    return this._disabled;
  }

  async start(): Promise<void> {
    if (this._disabled || this.stopping) return;
    this.spawnChild();
  }

  attachFrameSource(source: FrameSource): void {
    if (this.frameSource) this.detachFrameSource();
    this.frameSource = source;
    source.on('keyframe', this.keyframeListener);
  }

  detachFrameSource(): void {
    if (!this.frameSource) return;
    this.frameSource.off('keyframe', this.keyframeListener);
    this.frameSource = null;
  }

  private onKeyframe(kf: KeyframeLike): void {
    if (this._disabled || !this.child) return;
    if (this.lastAcceptedHash !== null) {
      const distance = hammingDistance(this.lastAcceptedHash, kf.phash);
      if (distance < this.phashThreshold) {
        this.framesDropped += 1;
        return;
      }
    }
    this.lastAcceptedHash = kf.phash;
    this.framesAccepted += 1;
    this.writeLengthPrefixed(kf.pngBytes);
  }

  private writeLengthPrefixed(bytes: Buffer): void {
    if (!this.child?.stdin) return;
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(bytes.length, 0);
    this.child.stdin.write(len);
    this.child.stdin.write(bytes);
  }

  async stop(): Promise<void> {
    this.detachFrameSource();
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

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
