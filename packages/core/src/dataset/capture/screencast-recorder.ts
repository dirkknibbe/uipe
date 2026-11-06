import type { Page, CDPSession } from 'playwright';
import type { ClockNormalizer } from '../../pipelines/temporal/event-stream.js';

export interface CapturedFrame { ts: number; jpeg: Buffer; scrollX: number; scrollY: number }

const MAX_FRAMES = 900; // ≈15 s at 60 fps

export class ScreencastRecorder {
  private cdp?: CDPSession;
  private frames: CapturedFrame[] = [];

  constructor(private page: Page, private normalizer: () => ClockNormalizer | undefined) {}

  async start(): Promise<void> {
    this.cdp = await this.page.context().newCDPSession(this.page);
    const cdp = this.cdp;
    cdp.on('Page.screencastFrame', (p: any) => {
      // Ack first so Chrome keeps producing frames regardless of our bookkeeping.
      void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
      const n = this.normalizer();
      if (!n) return;
      this.frames.push({
        ts: n.fromWallTimeMs(p.metadata.timestamp * 1000),
        jpeg: Buffer.from(p.data, 'base64'),
        scrollX: p.metadata.scrollOffsetX ?? 0,
        scrollY: p.metadata.scrollOffsetY ?? 0,
      });
      if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1,
    });
  }

  async stop(): Promise<void> {
    const cdp = this.cdp;
    this.cdp = undefined;
    if (!cdp) return;
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }

  framesBetween(startTs: number, endTs: number): CapturedFrame[] {
    return this.frames.filter((f) => f.ts >= startTs && f.ts <= endTs);
  }

  dropBefore(ts: number): void {
    this.frames = this.frames.filter((f) => f.ts >= ts);
  }
}
