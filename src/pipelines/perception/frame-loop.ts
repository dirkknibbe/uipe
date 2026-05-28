/**
 * FrameLoop — keyframe-driven perception tier.
 *
 * Wakes on every FrameCapture `keyframe` event. Tracks active animations by
 * subscribing to `TemporalEventStream`'s `event` emitter (animation-start /
 * animation-end). Collects per-node mutation records from a page-side
 * MutationObserver (not from the batched MutationCollector, which only carries
 * counters). Runs the pure `detectMutationOutsideAnimation` detector on each
 * keyframe and emits anomaly + escalation events via `PerceptionSession`.
 */

import type { Page } from 'playwright';
import type { FrameCapture } from '../visual/frame-capture.js';
import type { TemporalEventStream } from '../temporal/event-stream.js';
import type { TimelineEvent, EventType } from '../temporal/collectors/types.js';
import type { KeyframeEvent } from '../../types/temporal.js';
import type { PerceptionSession } from './session.js';
import { createLogger } from '../../utils/logger.js';
import {
  detectMutationOutsideAnimation,
  DEFAULT_CONFIG,
  type DetectConfig,
  type MutationRecord,
} from './anomaly/mutation-outside-animation.js';

const logger = createLogger('PerceptionFrameLoop');

// Payload sent from the page side per mutation.
interface PageMutationPayload {
  timestamp: number;
  targetNodeId: string;
}

export interface FrameLoopOptions {
  session: PerceptionSession;
  frameCapture: FrameCapture;
  eventStream: TemporalEventStream;
  /** Optional: provide a Playwright Page to install the page-side observer. */
  page?: Page;
  config?: Partial<DetectConfig>;
}

// ---------------------------------------------------------------------------
// Module-level WeakMap dispatcher (Fix 2: second-session mutation routing).
//
// When page.exposeFunction throws "already registered", the OLD closure is
// still bound on the page. Using a WeakMap keyed by Page lets the page-side
// function look up the *current* FrameLoop owner, so second (and later)
// sessions receive their mutations correctly.
// ---------------------------------------------------------------------------
type FrameLoopDispatch = (payload: PageMutationPayload) => void;
const frameLoopDispatchers = new WeakMap<Page, FrameLoopDispatch>();

export class FrameLoop {
  private readonly session: PerceptionSession;
  private readonly frameCapture: FrameCapture;
  private readonly eventStream: TemporalEventStream;
  private readonly page: Page | undefined;
  private readonly config: DetectConfig;

  private activeAnimations = new Set<string>();
  private recentMutations: MutationRecord[] = [];
  private lastAnomalyEmittedAt = -Infinity;

  /** Once stop() is called, in-flight handler callbacks become no-ops.
   *  Mirrors the running/stopped guard used by SemanticLoop + IntentLoop. */
  private stopped = false;

  // Bound handlers so we can removeListener in stop().
  private readonly onKeyframe = (kf: KeyframeEvent): void => {
    this.handleKeyframe(kf.timestamp);
  };

  private readonly onStreamEvent = (e: TimelineEvent<EventType>): void => {
    this.handleStreamEvent(e);
  };

  // Reinstalls the page-side observer after SPA navigation (Fix 1).
  //
  // Playwright invokes this listener fire-and-forget — any throw from
  // installPageObserver (target closed mid-nav, evaluate timeout, etc.)
  // would become an unhandled rejection AND leave the loop firing keyframes
  // with zero mutations arriving. Catch + log so the failure is observable.
  //
  // P2-N1: discriminate known Playwright races from genuinely unexpected
  // errors. A `TargetClosed` mid-nav is expected and shouldn't trip alarms;
  // a TypeError from a refactor bug should be loud.
  private readonly onFrameNavigated = async (): Promise<void> => {
    if (!this.page) return;
    try {
      await this.installPageObserver(this.page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : String(err);
      const isKnownPlaywrightRace =
        /target.*closed/i.test(msg) ||
        /execution context.*destroyed/i.test(msg);
      if (isKnownPlaywrightRace) {
        logger.warn('FrameLoop: observer reinstall raced with page lifecycle (expected during nav)', {
          error: stack,
        });
      } else {
        logger.error('FrameLoop: UNEXPECTED error reinstalling page-side observer after navigation', {
          error: stack,
        });
      }
    }
  };

  constructor(opts: FrameLoopOptions) {
    this.session = opts.session;
    this.frameCapture = opts.frameCapture;
    this.eventStream = opts.eventStream;
    this.page = opts.page;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
  }

  /**
   * Start the loop. Installs the page-side MutationObserver (if a page was
   * provided), subscribes to FrameCapture keyframes, stream events, and
   * framenavigated (to reinstall after SPA route changes).
   */
  async start(): Promise<void> {
    if (this.page) {
      await this.installPageObserver(this.page);
      // Fix 1: subscribe to navigation so the observer is reinstalled after
      // each SPA route change. The session's onPageNav also fires but only
      // resets startedAt — these two handlers are independent.
      this.page.on('framenavigated', this.onFrameNavigated);
    }
    this.frameCapture.on('keyframe', this.onKeyframe);
    this.eventStream.on('event', this.onStreamEvent);
  }

  /** Stop the loop and clean up subscriptions. */
  stop(): void {
    this.stopped = true;
    if (this.page) {
      this.page.off('framenavigated', this.onFrameNavigated);
      // Remove this loop from the dispatcher so a future session starts clean.
      frameLoopDispatchers.delete(this.page);
    }
    this.frameCapture.off('keyframe', this.onKeyframe);
    this.eventStream.off('event', this.onStreamEvent);
    this.activeAnimations.clear();
    this.recentMutations = [];
    this.lastAnomalyEmittedAt = -Infinity;
  }

  // ---------------------------------------------------------------------------
  // Test seams
  // ---------------------------------------------------------------------------

  /** Push a synthetic mutation record — used in unit tests instead of the
   * page-side observer. */
  addMutationForTest(timestamp: number, targetNodeId: string): void {
    this.recentMutations.push({ timestamp, targetNodeId });
  }

  /** Expose active-animation set for test assertions. */
  getActiveAnimationsForTest(): Set<string> {
    return this.activeAnimations;
  }

  /** Expose recent-mutation ring buffer for test assertions. */
  getRecentMutationsForTest(): MutationRecord[] {
    return this.recentMutations;
  }

  // ---------------------------------------------------------------------------
  // Page-side observer
  // ---------------------------------------------------------------------------

  /**
   * Installs a per-node MutationObserver on the page. Each mutation record
   * gets a synthetic ID via a WeakMap to avoid touching the DOM. The ID is
   * sent back over an exposed function.
   *
   * Strategy mirrors MutationCollector's pattern (exposeFunction +
   * page.evaluate guard) but emits one record per mutation rather than
   * batched counters.
   *
   * Fix 2: uses a module-level WeakMap dispatcher so that when
   * exposeFunction throws "already registered" (because a prior FrameLoop
   * left the binding), the page-side closure still routes to *this* instance.
   *
   * Fix 1: also called on every `framenavigated` event so mutations are
   * not silently lost after SPA route changes (which destroy the page-side
   * flag + observer).
   */
  private async installPageObserver(page: Page): Promise<void> {
    // Register this instance as the current dispatcher for this Page.
    frameLoopDispatchers.set(page, (payload: PageMutationPayload) => {
      this.recentMutations.push({
        timestamp: payload.timestamp,
        targetNodeId: payload.targetNodeId,
      });
    });

    try {
      // The stable closure looks up the current dispatcher via the WeakMap,
      // so a second (or later) FrameLoop session automatically gets its
      // mutations even though the function binding is from the first session.
      await page.exposeFunction(
        '__uipeFrameLoopMutation',
        (payload: PageMutationPayload) => {
          const fn = frameLoopDispatchers.get(page);
          if (fn) fn(payload);
        },
      );
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (!msg.includes('registered')) {
        throw err;
      }
      // Already registered from a prior attach. The WeakMap dispatcher above
      // ensures the old closure now routes to this FrameLoop instance.
      // Note: DEFERRED — only the FIRST session on a given page lifecycle
      // works correctly; subsequent sessions on the same page lifetime are
      // handled by the WeakMap redirect. See spec follow-up for full fix.
    }

    // After navigation the flag is gone — always re-run evaluate so the
    // MutationObserver is reinstalled on the new document.
    await page.evaluate(() => {
      const win = window as any;
      if (win.__uipeFrameLoopMutationInstalled) return;
      win.__uipeFrameLoopMutationInstalled = true;

      // WeakMap keeps synthetic IDs without touching DOM attributes.
      const nodeIds = new WeakMap<Node, string>();
      let counter = 0;

      const getNodeId = (node: Node): string => {
        let id = nodeIds.get(node);
        if (!id) {
          id = `mut-${counter++}`;
          nodeIds.set(node, id);
        }
        return id;
      };

      const observer = new MutationObserver((records) => {
        const now = Date.now();
        for (const r of records) {
          const targetNodeId = getNodeId(r.target);
          (win.__uipeFrameLoopMutation as (p: { timestamp: number; targetNodeId: string }) => void)?.({
            timestamp: now,
            targetNodeId,
          });
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleStreamEvent(e: TimelineEvent<EventType>): void {
    if (this.stopped) return;
    if (e.type === 'animation-start') {
      const payload = (e as TimelineEvent<'animation-start'>).payload;
      this.activeAnimations.add(payload.animationId);
    } else if (e.type === 'animation-end') {
      const payload = (e as TimelineEvent<'animation-end'>).payload;
      this.activeAnimations.delete(payload.animationId);
    }
    // Mutations are sourced from the page-side observer, not the stream.
  }

  private handleKeyframe(nowMs: number): void {
    if (this.stopped) return;
    // Trim ring buffer to lookback window.
    this.recentMutations = this.recentMutations.filter(
      (m) => nowMs - m.timestamp <= this.config.lookbackMs,
    );

    // Record the frame-tier tick.
    this.session.recordTick('frame', 'keyframe', nowMs);

    // Debounce: skip detector if we emitted an anomaly very recently.
    if (nowMs - this.lastAnomalyEmittedAt <= this.config.coalesceWindowMs) {
      return;
    }

    const result = detectMutationOutsideAnimation(
      {
        recentMutations: this.recentMutations,
        activeAnimations: this.activeAnimations,
        nowMs,
        sessionStartMs: this.session.getStartedAt(),
      },
      this.config,
    );

    if (!result) return;

    this.lastAnomalyEmittedAt = nowMs;

    // v1: no bbox info available at this tier; semantic loop resolves bboxes.
    const regions = result.targetNodeIds.map((nodeId) => ({
      nodeId,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
    }));

    this.session.recordAnomaly('frame', 'mutation-outside-animation', result, nowMs);
    this.session.recordEscalation(
      'frame',
      'semantic',
      'mutation-outside-animation',
      regions,
      nowMs,
    );
    this.session.internalEmitter.emit('escalate', { from: 'frame', regions });
  }
}
