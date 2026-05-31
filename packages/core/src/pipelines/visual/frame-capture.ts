import { EventEmitter } from 'events';
import type { Page } from 'playwright';
import type { CDPSession } from 'playwright';
import sharp from 'sharp';
import type { KeyframeEvent } from '../../types/index.js';
import { Config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FrameCapture');

export class FrameCapture extends EventEmitter {
  private cdp: CDPSession | null = null;
  private lastFrameHash: bigint = 0n;
  private lastFrameBuffer: Buffer | null = null;
  private isCapturing = false;
  private frameCount = 0;
  private burstUntil = 0;

  private config = {
    baseFps: Config.frameCapture.baseFps,
    burstFps: Config.frameCapture.burstFps,
    burstDurationMs: Config.frameCapture.burstDurationMs,
    diffThreshold: Config.frameCapture.diffThreshold,
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 80,
  };

  async start(page: Page): Promise<void> {
    this.cdp = await page.context().newCDPSession(page);

    await this.cdp.send('Page.startScreencast', {
      format: 'png',
      quality: this.config.quality,
      maxWidth: this.config.maxWidth,
      maxHeight: this.config.maxHeight,
      everyNthFrame: 1,
    });

    this.isCapturing = true;
    this.frameCount = 0;
    logger.info('Frame capture started');

    this.cdp.on('Page.screencastFrame', async (params) => {
      const { data, sessionId } = params as { data: string; metadata: { timestamp?: number }; sessionId: number };
      await this.cdp!.send('Page.screencastFrameAck', { sessionId });

      const frameBuffer = Buffer.from(data, 'base64');
      const timestamp = Date.now();
      this.frameCount++;

      const inBurst = timestamp < this.burstUntil;
      const targetFps = inBurst ? this.config.burstFps : this.config.baseFps;
      const skipInterval = Math.max(1, Math.round(60 / targetFps));

      if (this.frameCount % skipInterval !== 0) {
        return;
      }

      const currentHash = await this.perceptualHash(frameBuffer);
      const distance = this.hammingDistance(this.lastFrameHash, currentHash);
      const isSignificant = distance > this.config.diffThreshold;

      if (isSignificant || inBurst) {
        this.lastFrameHash = currentHash;
        this.lastFrameBuffer = frameBuffer;

        const keyframe: KeyframeEvent = {
          frame: frameBuffer,
          timestamp,
          trigger: isSignificant ? 'significant_diff' : 'periodic',
        };

        this.emit('keyframe', keyframe);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.cdp && this.isCapturing) {
      await this.cdp.send('Page.stopScreencast');
      this.isCapturing = false;
      logger.info('Frame capture stopped', { framesProcessed: this.frameCount });
    }
  }

  triggerBurst(event: string): void {
    this.burstUntil = Date.now() + this.config.burstDurationMs;
    logger.info('Burst mode activated', { event, durationMs: this.config.burstDurationMs });

    if (this.lastFrameBuffer) {
      this.emit('keyframe', {
        frame: this.lastFrameBuffer,
        timestamp: Date.now(),
        trigger: 'user_event',
        metadata: { event },
      } as KeyframeEvent);
    }
  }

  get capturing(): boolean {
    return this.isCapturing;
  }

  get totalFrames(): number {
    return this.frameCount;
  }

  async perceptualHash(imageBuffer: Buffer): Promise<bigint> {
    const { data } = await sharp(imageBuffer)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8Array(data);
    const mean = pixels.reduce((sum, val) => sum + val, 0) / 64;

    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      if (pixels[i] > mean) {
        hash |= 1n << BigInt(i);
      }
    }

    return hash;
  }

  hammingDistance(a: bigint, b: bigint): number {
    let xor = a ^ b;
    let distance = 0;
    while (xor > 0n) {
      distance += Number(xor & 1n);
      xor >>= 1n;
    }
    return distance;
  }
}
