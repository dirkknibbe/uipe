import type { Page, CDPSession } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

let nextId = 0;

export class AnimationCollector implements Collector {
  readonly name = 'animation';
  private cdp: CDPSession | undefined;

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
          setTimeout(() => {
            stream.push({
              id: `anim-end-${++nextId}`,
              type: 'animation-end',
              timestamp: normalizer.fromPerformanceNow(performance.now()),
              payload: { animationId: a.id, reason: 'completed' },
            });
          }, duration + 16);
        }
      });

      this.cdp.on('Animation.animationCanceled', (params: any) => {
        stream.push({
          id: `anim-end-${++nextId}`,
          type: 'animation-end',
          timestamp: normalizer.fromPerformanceNow(performance.now()),
          payload: {
            animationId: params.id,
            reason: 'canceled',
          },
        });
      });
    } catch (err) {
      console.warn(`AnimationCollector: attach failed (${(err as Error).message})`);
    }
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
