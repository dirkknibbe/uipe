import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import type {
  AnomalyReason,
  PerceptionTier,
  PerceptionEscalationPayload,
} from '../temporal/collectors/types.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSessionSummary } from './types.js';
import type { FrameCapture } from '../visual/frame-capture.js';
import type { StructuralPipeline } from '../structural/index.js';
import type { Indexer } from '../component-index/indexer.js';
import { FrameLoop } from './frame-loop.js';
import { SemanticLoop } from './semantic-loop.js';
import { IntentLoop, type ClassifyByVlmFn } from './intent-loop.js';

const TARGET_CADENCE_MS: Record<PerceptionTier, number> = {
  frame: 16,        // not actually used — frame is keyframe-bound; surfaced for inspection
  semantic: 200,
  intent: 1000,
};

const ALL_ANOMALY_REASONS: AnomalyReason[] = ['mutation-outside-animation'];

interface PerceptionSessionOptions {
  eventStream: TemporalEventStream;
}

export interface SessionStartDeps {
  page: Page;
  frameCapture: FrameCapture;
  indexer: Indexer;
  structuralPipeline: StructuralPipeline;
  classifyByVlm: ClassifyByVlmFn;
  getScreenshot: () => Promise<Buffer | null>;
}

interface TickRecord {
  count: number;
  lastTimestamp: number | null;
  intervalSum: number;     // sum of intervals between consecutive ticks
  intervalCount: number;   // number of intervals (count - 1)
}

export class PerceptionSession {
  readonly internalEmitter = new EventEmitter();

  private state: 'idle' | 'running' | 'stopped' = 'idle';
  private startedAt = 0;
  private stoppedAt = 0;
  private readonly stream: TemporalEventStream;

  private frameLoop: FrameLoop | null = null;
  private semanticLoop: SemanticLoop | null = null;
  private intentLoop: IntentLoop | null = null;
  private page: Page | null = null;

  private readonly onPageNav = (): void => {
    const now = Date.now();
    this.resetStartedAt(now);
    this.recordTick('frame', 'navigation-reset', now);
  };

  private readonly onPageClose = (): void => {
    if (this.isRunning()) {
      try { this.stop(Date.now()); } catch { /* already stopped */ }
    }
  };

  private readonly ticks: Record<PerceptionTier, TickRecord> = {
    frame:    { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
    semantic: { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
    intent:   { count: 0, lastTimestamp: null, intervalSum: 0, intervalCount: 0 },
  };

  private anomalyCount = 0;
  private anomaliesByReason: Record<AnomalyReason, number> = {
    'mutation-outside-animation': 0,
  };
  private escalationCount = 0;
  private intentResultCount = 0;
  private vlmCallCount = 0;

  constructor(options: PerceptionSessionOptions) {
    this.stream = options.eventStream;
  }

  start(nowMs: number, deps?: SessionStartDeps): void {
    if (this.state !== 'idle') {
      throw new Error(`PerceptionSession.start() called in state "${this.state}"`);
    }
    this.state = 'running';
    this.startedAt = nowMs;

    if (deps) {
      this.page = deps.page;
      this.frameLoop = new FrameLoop({
        session: this,
        frameCapture: deps.frameCapture,
        eventStream: this.stream,
        page: deps.page,
      });
      this.semanticLoop = new SemanticLoop({
        session: this,
        eventStream: this.stream,
        indexer: deps.indexer,
        structuralPipeline: deps.structuralPipeline,
        page: deps.page,
      });
      this.intentLoop = new IntentLoop({
        session: this,
        eventStream: this.stream,
        classifyByVlm: deps.classifyByVlm,
        getScreenshot: deps.getScreenshot,
      });
      this.frameLoop.start();
      this.semanticLoop.start();
      this.intentLoop.start();
      deps.page.on('framenavigated', this.onPageNav);
      deps.page.on('close', this.onPageClose);
    }
  }

  stop(nowMs: number): void {
    if (this.state !== 'running') {
      throw new Error(`PerceptionSession.stop() called in state "${this.state}"`);
    }
    this.state = 'stopped';
    this.stoppedAt = nowMs;
    this.frameLoop?.stop();
    this.semanticLoop?.stop();
    this.intentLoop?.stop();
    this.frameLoop = null;
    this.semanticLoop = null;
    this.intentLoop = null;
    if (this.page) {
      this.page.off('framenavigated', this.onPageNav);
      this.page.off('close', this.onPageClose);
      this.page = null;
    }
    this.internalEmitter.removeAllListeners();
  }

  isRunning(): boolean {
    return this.state === 'running';
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  /** Reset startedAt after a navigation event so the warmup gate re-applies. */
  resetStartedAt(nowMs: number): void {
    this.startedAt = nowMs;
  }

  recordTick(
    tier: PerceptionTier,
    cause: 'keyframe' | 'heartbeat' | 'escalation' | 'navigation-reset',
    timestamp: number,
  ): void {
    const t = this.ticks[tier];
    t.count += 1;
    if (t.lastTimestamp !== null) {
      t.intervalSum += timestamp - t.lastTimestamp;
      t.intervalCount += 1;
    }
    t.lastTimestamp = timestamp;
    this.stream.push({
      id: randomUUID(),
      type: 'perception-tick',
      timestamp,
      payload: { tier, cause },
    });
  }

  recordAnomaly(
    tier: PerceptionTier,
    reason: AnomalyReason,
    detail: { mutationCount: number; targetNodeIds: string[] },
    timestamp: number,
  ): void {
    this.anomalyCount += 1;
    this.anomaliesByReason[reason] += 1;
    this.stream.push({
      id: randomUUID(),
      type: 'perception-anomaly',
      timestamp,
      payload: { tier, reason, detail },
    });
  }

  recordEscalation(
    from: PerceptionTier,
    to: PerceptionTier,
    reason: AnomalyReason,
    regions: PerceptionEscalationPayload['regions'],
    timestamp: number,
  ): void {
    this.escalationCount += 1;
    this.stream.push({
      id: randomUUID(),
      type: 'perception-escalation',
      timestamp,
      payload: { from, to, reason, regions },
    });
  }

  recordIntentResult(
    region: { nodeId: string; bbox: { x: number; y: number; w: number; h: number } },
    classification: string,
    durationMs: number,
    timestamp: number,
  ): void {
    this.intentResultCount += 1;
    this.vlmCallCount += 1;
    this.stream.push({
      id: randomUUID(),
      type: 'perception-intent-result',
      timestamp,
      payload: { region, classification, classificationSource: 'vlm', durationMs },
    });
  }

  getSummary(): PerceptionSessionSummary {
    const now = this.state === 'running' ? Date.now() : this.stoppedAt;
    const durationMs = this.state === 'idle' ? 0 : now - this.startedAt;

    const averageCadenceMs: Record<PerceptionTier, number | null> = {
      frame:    this.ticks.frame.intervalCount > 0    ? this.ticks.frame.intervalSum    / this.ticks.frame.intervalCount    : null,
      semantic: this.ticks.semantic.intervalCount > 0 ? this.ticks.semantic.intervalSum / this.ticks.semantic.intervalCount : null,
      intent:   this.ticks.intent.intervalCount > 0   ? this.ticks.intent.intervalSum   / this.ticks.intent.intervalCount   : null,
    };

    // Initialize anomaliesByReason buckets with zeros even if never fired
    const anomaliesByReason = {} as Record<AnomalyReason, number>;
    for (const r of ALL_ANOMALY_REASONS) {
      anomaliesByReason[r] = this.anomaliesByReason[r] ?? 0;
    }

    return {
      startedAt: this.startedAt,
      durationMs,
      tickCounts: {
        frame:    this.ticks.frame.count,
        semantic: this.ticks.semantic.count,
        intent:   this.ticks.intent.count,
      },
      averageCadenceMs,
      targetCadenceMs: TARGET_CADENCE_MS,
      anomalyCount: this.anomalyCount,
      anomaliesByReason,
      escalationCount: this.escalationCount,
      intentResultCount: this.intentResultCount,
      vlmCalls: { count: this.vlmCallCount },
    };
  }
}
