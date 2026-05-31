import type { Page, CDPSession } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

let nextId = 0;

export class NetworkCollector implements Collector {
  readonly name = 'network';
  private cdp: CDPSession | undefined;

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('NetworkCollector: stream not attached, skipping');
      return;
    }

    try {
      this.cdp = await page.context().newCDPSession(page);
      await this.cdp.send('Network.enable');

      this.cdp.on('Network.requestWillBeSent', (params: any) => {
        stream.push({
          id: `net-req-${++nextId}`,
          type: 'network-request',
          timestamp: params.wallTime !== undefined
            ? normalizer.fromWallTimeMs(params.wallTime * 1000)
            : performance.now() - 0,
          payload: {
            requestId: params.requestId,
            url: params.request.url,
            method: params.request.method,
          },
        });
      });

      this.cdp.on('Network.responseReceived', (params: any) => {
        stream.push({
          id: `net-resp-${++nextId}`,
          type: 'network-response',
          timestamp: params.response?.timing?.requestTime !== undefined
            ? normalizer.fromCdpMonotonicSeconds(params.response.timing.requestTime)
            : normalizer.fromPerformanceNow(performance.now()),
          payload: {
            requestId: params.requestId,
            url: params.response.url,
            status: params.response.status,
          },
        });
      });
    } catch (err) {
      console.warn(`NetworkCollector: attach failed (${(err as Error).message})`);
    }
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      try { await this.cdp.detach(); } catch { /* ignore */ }
      this.cdp = undefined;
    }
  }
}
