/**
 * IntentLoop — event-driven intent tier.
 *
 * Wakes only on semantic→intent escalations (internalEmitter 'escalate' with
 * `from: 'semantic'`). For each escalated region, it crops the latest screenshot
 * via sharp and calls the injected VLM classifier. Results are written to the
 * event stream via session.recordIntentResult.
 *
 * Backpressure: if pending items exceed maxPending, the oldest is dropped so the
 * queue never grows unbounded.
 */

import sharp from 'sharp';
import { createLogger } from '../../utils/logger.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { PerceptionSession } from './session.js';

const logger = createLogger('PerceptionIntentLoop');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClassifyByVlmFn = (args: { html: string; screenshotCrop: Buffer }) => Promise<string>;

export interface IntentLoopOptions {
  session: PerceptionSession;
  eventStream: TemporalEventStream;
  getScreenshot: () => Promise<Buffer | null>;
  classifyByVlm: ClassifyByVlmFn;
  config?: { maxPending?: number };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PendingItem {
  nodeId: string;
  bbox: { x: number; y: number; w: number; h: number };
}

// ---------------------------------------------------------------------------
// IntentLoop
// ---------------------------------------------------------------------------

export class IntentLoop {
  private readonly session: PerceptionSession;
  private readonly getScreenshot: () => Promise<Buffer | null>;
  private readonly classify: ClassifyByVlmFn;
  private readonly maxPending: number;

  private pending: PendingItem[] = [];
  private draining = false;
  private running = false;

  // Arrow function so we can pass it directly to on/off without binding.
  private readonly onEscalate = (payload: { from: string; regions: PendingItem[] }): void => {
    if (payload.from !== 'semantic') return;
    for (const region of payload.regions) {
      this.enqueue(region);
    }
    void this.drain();
  };

  constructor(opts: IntentLoopOptions) {
    this.session = opts.session;
    this.getScreenshot = opts.getScreenshot;
    this.classify = opts.classifyByVlm;
    this.maxPending = opts.config?.maxPending ?? 10;
  }

  start(): void {
    this.running = true;
    this.session.internalEmitter.on('escalate', this.onEscalate);
  }

  stop(): void {
    this.running = false;
    this.session.internalEmitter.off('escalate', this.onEscalate);
    this.pending = [];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private enqueue(item: PendingItem): void {
    // Enqueue first, then drop oldest if over limit.
    this.pending.push(item);
    if (this.pending.length > this.maxPending) {
      const dropped = this.pending.shift();
      logger.warn('IntentLoop: dropping oldest pending region due to backpressure', {
        dropped: dropped?.nodeId,
        pendingCount: this.pending.length,
      });
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    if (this.pending.length === 0) return;
    this.draining = true;

    try {
      // One tick per drain cycle, not per region.
      const tickAt = Date.now();
      this.session.recordTick('intent', 'escalation', tickAt);

      const screenshot = await this.getScreenshot();
      if (!screenshot) {
        // Can't classify without a screenshot — drop all pending.
        this.pending = [];
        return;
      }

      // Snapshot the queue and reset it so new arrivals during the drain
      // accumulate independently and trigger a follow-up drain.
      const items = this.pending.splice(0);

      for (const item of items) {
        if (!this.running) break;
        const start = Date.now();
        try {
          const crop = await cropToBbox(screenshot, item.bbox);
          const classification = await this.classify({ html: '', screenshotCrop: crop });
          const duration = Date.now() - start;
          this.session.recordIntentResult(
            { nodeId: item.nodeId, bbox: item.bbox },
            classification,
            duration,
            Date.now(),
          );
        } catch (err) {
          logger.warn('IntentLoop: per-region classification failed, skipping', {
            nodeId: item.nodeId,
            error: String(err),
          });
        }
      }
    } finally {
      this.draining = false;
      // If new items arrived while we were draining, kick off another cycle.
      if (this.pending.length > 0 && this.running) {
        void this.drain();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cropToBbox(
  png: Buffer,
  bbox: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.max(1, Math.round(bbox.w));
  const height = Math.max(1, Math.round(bbox.h));
  return sharp(png).extract({ left, top, width, height }).png().toBuffer();
}
