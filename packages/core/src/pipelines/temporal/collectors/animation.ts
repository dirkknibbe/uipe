import type { Page, CDPSession } from 'playwright';
import type { Collector, AnimationStartPayload } from './types.js';
import type { TemporalEventStream, ClockNormalizer } from '../event-stream.js';
import { AnimationVerifier } from '../verifiers/animation/verifier.js';

let nextId = 0;

const reportKey = (id: string, name: string | undefined) => `${id}|${name ?? ''}`;

interface AnimationStartState {
  startTimestamp: number;
  wallTimeAtStart: number;
  duration: number;
  /** startTimestamp is on this clock; the stream re-anchors on every navigation */
  normalizer: ClockNormalizer;
  key: string;
  completionTimer?: ReturnType<typeof setTimeout>;
}

export class AnimationCollector implements Collector {
  readonly name = 'animation';
  private cdp: CDPSession | undefined;
  private active = new Map<string, AnimationStartState>();
  private verifier = new AnimationVerifier();
  /**
   * Starts pushed by this session and the one before it. The stream re-attaches collectors on every
   * navigation, and Animation.enable replays every animation that already exists (same id), so a
   * start the previous session reported must not be pushed twice.
   */
  private reported = new Map<string, AnimationStartPayload>();
  private reportedBefore = new Map<string, AnimationStartPayload>();

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const attachNormalizer = stream.getNormalizer();
    if (!attachNormalizer) {
      console.warn('AnimationCollector: stream not attached, skipping');
      return;
    }

    this.reportedBefore = this.reported;
    this.reported = new Map();
    try {
      this.cdp = await page.context().newCDPSession(page);

      this.cdp.on('Animation.animationStarted', async (params: any) => {
        // The stream re-anchors its clock on navigation; stamp with the clock in force now.
        const normalizer = stream.getNormalizer() ?? attachNormalizer;
        const a = params.animation;
        const key = reportKey(a.id, a.name);
        const already = this.reportedBefore.get(key);
        if (already) {
          this.reportedBefore.delete(key);
          this.reported.set(key, already);
          // The old session may have closed before reading the target; this one can.
          if (!already.targetMarker && this.cdp) await this.fillTarget(this.cdp, params, already);
          return;
        }
        // CDP startTime is page-clock milliseconds, not seconds.
        const startTimestamp = a.startTime !== undefined
          ? normalizer.fromCdpMonotonicSeconds(a.startTime / 1000)
          : normalizer.fromPerformanceNow(performance.now());
        const duration = a.source?.duration ?? 0;
        const iterations: number = a.source?.iterations ?? Infinity;
        const delay: number = a.source?.delay ?? 0;
        const endDelay: number = a.source?.endDelay ?? 0;
        const totalMs = delay + duration * iterations + endDelay;
        const wallTimeAtStart = Date.now();

        const state: AnimationStartState = {
          startTimestamp,
          wallTimeAtStart,
          duration,
          normalizer,
          key,
        };
        this.active.set(a.id, state);

        const startPayload: AnimationStartPayload = {
          animationId: a.id,
          name: a.name,
          duration,
          easing: a.source?.easing,
          iterations,
          delay,
          endDelay,
        };
        this.reported.set(key, startPayload);
        stream.push({
          id: `anim-start-${++nextId}`,
          type: 'animation-start',
          timestamp: startTimestamp,
          payload: startPayload,
        });

        // Predict + emit prediction event.
        // Outer try/catch guards against unexpected programmer errors in the
        // verifier itself — the verifier already returns skipped payloads for
        // all expected CDP failure modes, so this catch is defense in depth.
        try {
          const cdp = this.cdp;
          if (cdp) {
            const predPayload = await this.verifier.captureStart(cdp, params, (t) => {
              // The target is only known after the in-page read, which must not delay
              // the start event; fill the already-pushed payload in place.
              if (!this.active.has(a.id)) return;
              if (t.selector) startPayload.target = t.selector;
              if (t.tag) startPayload.targetTag = t.tag;
              if (t.marker) startPayload.targetMarker = t.marker;
            });
            // Race guard: if the animation was canceled while captureStart
            // awaited its CDP roundtrip, animationCanceled has already
            // cleared this.active[a.id] and pushed animation-end. Skip the
            // prediction emit to keep the timeline's terminal-event invariant.
            if (this.active.has(a.id)) {
              stream.push({
                id: `anim-pred-${++nextId}`,
                type: 'animation-prediction',
                timestamp: startTimestamp,
                payload: { ...predPayload, expectedEndTimestamp: startTimestamp + duration },
              });
            } else {
              this.verifier.discard(a.id);
            }
          }
        } catch (err) {
          console.warn(`AnimationCollector: prediction failed (${(err as Error).message})`);
        }

        if (duration <= 0) {
          // Nothing will ever end it; without this the entry leaks.
          this.active.delete(a.id);
        } else if (Number.isFinite(totalMs)) {
          state.completionTimer = setTimeout(async () => {
            let deviation = null;
            try {
              const cdp = this.cdp;
              if (cdp) {
                deviation = await this.verifier.observe(cdp, a.id);
              }
            } catch (err) {
              console.warn(`AnimationCollector: observation failed (${(err as Error).message})`);
            }
            this.active.delete(a.id);
            const timestamp = this.endTimestamp(stream, state, state.wallTimeAtStart + totalMs);
            if (timestamp === undefined) return;
            stream.push({
              id: `anim-end-${++nextId}`,
              type: 'animation-end',
              timestamp,
              payload: deviation
                ? { animationId: a.id, reason: 'completed', deviation }
                : { animationId: a.id, reason: 'completed' },
            });
          }, totalMs + 16);
        }
      });

      this.cdp.on('Animation.animationCanceled', (params: any) => {
        const id = params.id;
        const state = this.active.get(id);
        if (state) {
          if (state.completionTimer) clearTimeout(state.completionTimer);
          this.active.delete(id);
        }
        const now = Date.now();
        const timestamp = (state && this.endTimestamp(stream, state, now))
          ?? (stream.getNormalizer() ?? attachNormalizer).fromWallTimeMs(now);

        this.verifier.discard(id);

        stream.push({
          id: `anim-end-${++nextId}`,
          type: 'animation-end',
          timestamp,
          payload: {
            animationId: id,
            reason: 'canceled',
          },
        });
      });
      // Enabled only once the listeners are on: enable replays existing animations before its reply.
      await this.cdp.send('Animation.enable');
    } catch (err) {
      console.warn(`AnimationCollector: attach failed (${(err as Error).message})`);
    }
  }

  /**
   * An end on the clock its start was stamped on. After a re-anchor that clock is gone: the end moves
   * to the current clock if this session replayed the start (the document survived), else it is
   * dropped (the document died with the navigation; an old-clock stamp would land in the new one).
   */
  private endTimestamp(stream: TemporalEventStream, state: AnimationStartState, wallMs: number): number | undefined {
    const current = stream.getNormalizer();
    if (current === state.normalizer) return state.startTimestamp + (wallMs - state.wallTimeAtStart);
    if (!current || !this.reported.has(state.key)) return undefined;
    return current.fromWallTimeMs(wallMs);
  }

  private async fillTarget(cdp: CDPSession, params: any, payload: AnimationStartPayload): Promise<void> {
    try {
      await this.verifier.captureStart(cdp, params, (t) => {
        if (t.selector) payload.target = t.selector;
        if (t.tag) payload.targetTag = t.tag;
        if (t.marker) payload.targetMarker = t.marker;
      });
    } catch { /* target stays unknown */ }
    this.verifier.discard(params.animation.id);
  }

  /**
   * The stream detaches and re-attaches collectors on every navigation, so completion timers and
   * reported starts survive it: an animation still running must still end exactly once.
   */
  async detach(): Promise<void> {
    this.verifier.clear();
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
