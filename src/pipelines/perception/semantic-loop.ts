/**
 * SemanticLoop — cadence-bounded semantic tier.
 *
 * Wakes when the frame loop escalates (via session.internalEmitter 'escalate'
 * events with `from: 'frame'`). On wake, it runs the full structural pipeline
 * + Indexer to find unclassified nodes, then escalates any pending nodes to
 * the intent tier.
 *
 * Design decision (option A): ignores the `regions[*].nodeId` from frame
 * escalation — those are synthetic `mut-N` IDs that don't map to structural
 * pipeline `dom-N` IDs. Instead, we do a full re-run and let the indexer's
 * output drive what gets escalated.
 */

import type { Page } from 'playwright';
import type { StructuralPipeline } from '../structural/index.js';
import type { Indexer } from '../component-index/indexer.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSession } from './session.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PerceptionSemanticLoop');

export interface SemanticLoopOptions {
  session: PerceptionSession;
  eventStream: TemporalEventStream;
  indexer: Indexer;
  structuralPipeline: StructuralPipeline;
  page: Page;
  config?: { cadenceMs?: number };
}

const DEFAULT_CADENCE_MS = 200;

export class SemanticLoop {
  private readonly session: PerceptionSession;
  private readonly indexer: Indexer;
  private readonly structuralPipeline: StructuralPipeline;
  private readonly page: Page;
  private readonly cadenceMs: number;

  /** True when the loop has seen at least one frame escalation since the last tick. */
  private hasPendingEscalation = false;
  /** Wall-clock time of the most recent semantic tick (ms). 0 = never ticked. */
  private lastTickMs = 0;
  /** Whether stop() has been called. */
  private stopped = false;
  /** Pending wake timer — tracked so stop() can clear it. */
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** P2-H1: blocks re-entrant tick() while a previous tick is still awaiting.
   *  The cadence gate's `lastTickMs !== 0` carve-out is insufficient on the
   *  very first tick — a second escalate arriving mid-await would otherwise
   *  bypass the gate (lastTickMs is still 0 until success) and run
   *  concurrently. */
  private inFlight = false;

  private readonly escalateHandler: (payload: { from: string; regions: unknown[] }) => void;

  constructor(options: SemanticLoopOptions) {
    this.session = options.session;
    this.indexer = options.indexer;
    this.structuralPipeline = options.structuralPipeline;
    this.page = options.page;
    this.cadenceMs = options.config?.cadenceMs ?? DEFAULT_CADENCE_MS;

    this.escalateHandler = (payload) => {
      if (payload.from !== 'frame') return;
      if (this.stopped) return;
      this.hasPendingEscalation = true;
      // Schedule a wake immediately; cadence gate prevents double-firing.
      this.scheduleWake();
    };
  }

  start(): void {
    this.stopped = false;
    this.session.internalEmitter.on('escalate', this.escalateHandler);
  }

  stop(): void {
    this.stopped = true;
    this.session.internalEmitter.off('escalate', this.escalateHandler);
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private scheduleWake(): void {
    // P2-I2: coalesce. A burst of escalates in the same JS turn previously
    // overwrote this.wakeTimer without clearing the prior handle, leaking
    // Node timer references. The pending state (hasPendingEscalation) is
    // already aggregated, so a second timer is just noise.
    if (this.wakeTimer !== null) return;
    const nowMs = Date.now();
    const elapsed = nowMs - this.lastTickMs;
    const delay = elapsed >= this.cadenceMs ? 0 : this.cadenceMs - elapsed;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      if (this.stopped) return;
      if (!this.hasPendingEscalation) return;
      this.hasPendingEscalation = false;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    // P2-H1: prevent concurrent re-entry while a previous tick is still
    // awaiting (the first-tick cadence carve-out is otherwise too permissive).
    if (this.inFlight) return;

    const nowMs = Date.now();
    // Enforce cadence: if another tick ran too recently, skip.
    if (nowMs - this.lastTickMs < this.cadenceMs && this.lastTickMs !== 0) return;

    this.inFlight = true;
    try {
      // I3 + P2-H2 fix: previously recordTick ran BEFORE the try, so a failed
      // tick still bumped tickCounts.semantic ("ghost ticks"). Plus the
      // awaited body had no catch — a throw from extractStructure /
      // indexer.run became an unhandled rejection AND lastTickMs was already
      // advanced (silently gating out the next escalation). Now both
      // recordTick and lastTickMs advance only on success.
      const structural = await this.structuralPipeline.extractStructure(this.page);
      const componentMap = await this.indexer.run(structural, {
        origin: this.page.url(),
      });

      // Build a lookup from node id → structural node for bbox resolution.
      const nodeById = new Map(structural.map((n) => [n.id, n]));

      // Collect nodes the indexer marked as pending (unclassified).
      const pendingRegions: Array<{ nodeId: string; bbox: { x: number; y: number; w: number; h: number } }> = [];
      for (const [nodeId, field] of componentMap) {
        if (field.name === null) {
          const node = nodeById.get(nodeId);
          const bb = node?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
          pendingRegions.push({
            nodeId,
            bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
          });
        }
      }

      // Tick succeeded — record the tick + advance the cadence gate now
      // (not before the await).
      this.session.recordTick('semantic', 'escalation', nowMs);
      this.lastTickMs = nowMs;

      if (pendingRegions.length === 0) return;

      // Escalate to intent tier.
      this.session.recordEscalation(
        'semantic',
        'intent',
        'mutation-outside-animation',
        pendingRegions,
        nowMs,
      );
      this.session.internalEmitter.emit('escalate', {
        from: 'semantic',
        regions: pendingRegions,
      });
    } catch (err) {
      logger.warn('SemanticLoop: tick failed; will retry on next escalation', {
        error: err instanceof Error ? err.stack : String(err),
      });
      // tickCounts.semantic and lastTickMs intentionally not advanced — the
      // next escalation can re-enter tick() without being gated out, and the
      // summary doesn't record a tick that did no work.
    } finally {
      this.inFlight = false;
    }
  }
}
