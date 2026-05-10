import type { Page, CDPSession } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

let nextId = 0;

interface AnimationStartState {
  startTimestamp: number;
  wallTimeAtStart: number;
  duration: number;
  completionTimer?: ReturnType<typeof setTimeout>;
}

export class AnimationCollector implements Collector {
  readonly name = 'animation';
  private cdp: CDPSession | undefined;
  private active = new Map<string, AnimationStartState>();

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('AnimationCollector: stream not attached, skipping');
      return;
    }

    try {
      this.cdp = await page.context().newCDPSession(page);
      await this.cdp.send('Animation.enable');

      this.cdp.on('Animation.animationStarted', (params: any) => {
        const a = params.animation;
        const startTimestamp = a.startTime !== undefined
          ? normalizer.fromCdpMonotonicSeconds(a.startTime)
          : normalizer.fromPerformanceNow(performance.now());
        const duration = a.source?.duration ?? 0;
        const wallTimeAtStart = Date.now();

        const state: AnimationStartState = {
          startTimestamp,
          wallTimeAtStart,
          duration,
        };
        this.active.set(a.id, state);

        stream.push({
          id: `anim-start-${++nextId}`,
          type: 'animation-start',
          timestamp: startTimestamp,
          payload: {
            animationId: a.id,
            name: a.name,
            duration,
            easing: a.source?.easing,
          },
        });

        if (duration > 0) {
          state.completionTimer = setTimeout(() => {
            // Predicted endpoint based on the start's normalized timestamp.
            // This avoids mixing host-side and page-side clocks.
            stream.push({
              id: `anim-end-${++nextId}`,
              type: 'animation-end',
              timestamp: startTimestamp + duration,
              payload: { animationId: a.id, reason: 'completed' },
            });
            this.active.delete(a.id);
          }, duration + 16);
        }
      });

      this.cdp.on('Animation.animationCanceled', (params: any) => {
        const id = params.id;
        const state = this.active.get(id);
        let timestamp: number;
        if (state) {
          if (state.completionTimer) clearTimeout(state.completionTimer);
          const elapsed = Date.now() - state.wallTimeAtStart;
          timestamp = state.startTimestamp + elapsed;
          this.active.delete(id);
        } else {
          // No matching start tracked — fall back to wall-clock-derived.
          timestamp = normalizer.fromWallTimeMs(Date.now());
        }

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
    } catch (err) {
      console.warn(`AnimationCollector: attach failed (${(err as Error).message})`);
    }
  }

  async detach(): Promise<void> {
    for (const state of this.active.values()) {
      if (state.completionTimer) clearTimeout(state.completionTimer);
    }
    this.active.clear();
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
