import type { Page, CDPSession } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';
import { AnimationVerifier } from '../verifiers/animation/verifier.js';

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
  private verifier = new AnimationVerifier();

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('AnimationCollector: stream not attached, skipping');
      return;
    }

    try {
      this.cdp = await page.context().newCDPSession(page);
      await this.cdp.send('Animation.enable');

      this.cdp.on('Animation.animationStarted', async (params: any) => {
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

        // Predict + emit prediction event.
        try {
          const cdp = this.cdp;
          if (cdp) {
            const predPayload = await this.verifier.captureStart(cdp, params, normalizer);
            stream.push({
              id: `anim-pred-${++nextId}`,
              type: 'animation-prediction',
              timestamp: startTimestamp,
              payload: { ...predPayload, expectedEndTimestamp: startTimestamp + duration },
            });
          }
        } catch (err) {
          console.warn(`AnimationCollector: prediction failed (${(err as Error).message})`);
        }

        if (duration > 0) {
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
            stream.push({
              id: `anim-end-${++nextId}`,
              type: 'animation-end',
              timestamp: startTimestamp + duration,
              payload: deviation
                ? { animationId: a.id, reason: 'completed', deviation }
                : { animationId: a.id, reason: 'completed' },
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
          timestamp = normalizer.fromWallTimeMs(Date.now());
        }

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
    } catch (err) {
      console.warn(`AnimationCollector: attach failed (${(err as Error).message})`);
    }
  }

  async detach(): Promise<void> {
    for (const state of this.active.values()) {
      if (state.completionTimer) clearTimeout(state.completionTimer);
    }
    this.active.clear();
    this.verifier.clear();
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
