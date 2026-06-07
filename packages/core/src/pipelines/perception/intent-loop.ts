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

/** P2-C1: cap per-failure ERROR logs when getScreenshot perma-throws.
 *  Above the threshold we emit one "suppressing further logs" notice and
 *  then go silent on logging (but still drop pending). The streak resets
 *  on the first successful screenshot. */
const SCREENSHOT_ERROR_LOG_THRESHOLD = 3;

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
  private screenshotErrorStreak = 0;

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
    // C1 belt-and-suspenders: skip even if a stale escalate kicked off a
    // drain between `running = false` and `internalEmitter.off(...)` in stop().
    if (!this.running) return;
    if (this.draining) return;
    if (this.pending.length === 0) return;
    this.draining = true;

    try {
      // One tick per drain cycle, not per region.
      // Guard: if stop() was called while we were awaiting, skip recording.
      const tickAt = Date.now();
      if (this.running) {
        this.session.recordTick('intent', 'escalation', tickAt);
      }

      let screenshot: Buffer | null;
      try {
        screenshot = await this.getScreenshot();
      } catch (err) {
        // P2-C1: bound log volume so a perma-throwing screenshot provider
        // doesn't spam ERROR per escalation for the rest of the session.
        // Below threshold → normal error log. AT threshold+1 → one "suppressing"
        // notice. Above → silent (still drops pending).
        this.screenshotErrorStreak += 1;
        if (this.screenshotErrorStreak <= SCREENSHOT_ERROR_LOG_THRESHOLD) {
          logger.error('IntentLoop: screenshot provider threw; dropping pending queue', {
            error: err instanceof Error ? err.stack : String(err),
            dropped: this.pending.length,
            streak: this.screenshotErrorStreak,
          });
        } else if (this.screenshotErrorStreak === SCREENSHOT_ERROR_LOG_THRESHOLD + 1) {
          logger.error(
            'IntentLoop: screenshot provider repeatedly throwing; suppressing further per-failure logs until next success',
            { streak: this.screenshotErrorStreak },
          );
        }
        this.pending = [];
        return;
      }
      if (!screenshot) {
        // Can't classify without a screenshot — drop all pending. Log so the
        // failure is visible; previously this branch was silent.
        logger.warn('IntentLoop: screenshot provider returned null; dropping pending queue', {
          dropped: this.pending.length,
        });
        this.pending = [];
        return;
      }
      // Screenshot succeeded — reset the error streak so future failures
      // log normally again.
      this.screenshotErrorStreak = 0;

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
          // Fix 5: guard against stop() arriving during the classify await.
          if (this.running) {
            this.session.recordIntentResult(
              { nodeId: item.nodeId, bbox: item.bbox },
              classification,
              duration,
              Date.now(),
            );
          }
        } catch (err) {
          // I2 fix: preserve stack so VLM timeouts / sharp crashes / model
          // errors are distinguishable in logs. Also count the failure so
          // a 100%-failed session is visible in the summary.
          // P2-I1 fix: gate on this.running so a late rejection after stop()
          // doesn't bump the metric on a torn-down session — mirroring the
          // success-path guard on recordIntentResult.
          if (this.running) {
            this.session.recordVlmError();
          }
          logger.warn('IntentLoop: per-region classification failed, skipping', {
            nodeId: item.nodeId,
            error: err instanceof Error ? err.stack : String(err),
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
