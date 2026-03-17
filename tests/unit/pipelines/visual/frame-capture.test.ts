import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PNG } from 'pngjs';
import { FrameCapture } from '../../../../src/pipelines/visual/frame-capture.js';

function createTestPNG(r: number, g: number, b: number, width = 8, height = 8): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('FrameCapture', () => {
  let capture: FrameCapture;

  beforeEach(() => {
    capture = new FrameCapture();
  });

  it('hammingDistance(0n, 0n) returns 0', () => {
    expect(capture.hammingDistance(0n, 0n)).toBe(0);
  });

  it('hammingDistance of known different hashes returns correct popcount', () => {
    // 0b1010 vs 0b0101 = 4 bits differ
    expect(capture.hammingDistance(0b1010n, 0b0101n)).toBe(4);
    // 0b1111 vs 0b0000 = 4 bits differ
    expect(capture.hammingDistance(0b1111n, 0b0000n)).toBe(4);
    // single bit difference
    expect(capture.hammingDistance(0b1000n, 0b0000n)).toBe(1);
  });

  it('perceptualHash returns a bigint for a valid PNG buffer', async () => {
    const png = createTestPNG(128, 128, 128);
    const hash = await capture.perceptualHash(png);
    expect(typeof hash).toBe('bigint');
  });

  it('perceptualHash of identical images returns identical hashes', async () => {
    const png1 = createTestPNG(100, 100, 100);
    const png2 = createTestPNG(100, 100, 100);
    const hash1 = await capture.perceptualHash(png1);
    const hash2 = await capture.perceptualHash(png2);
    expect(hash1).toBe(hash2);
  });

  it('perceptualHash of visually different images returns different hashes', async () => {
    // Create a mostly black image
    const blackPng = createTestPNG(0, 0, 0);
    // Create a mostly white image
    const whitePng = createTestPNG(255, 255, 255);
    const hash1 = await capture.perceptualHash(blackPng);
    const hash2 = await capture.perceptualHash(whitePng);
    // They should differ — at least some bits different
    // Note: uniform images may hash to all-0 or all-1 depending on mean,
    // but they should still have different distributions in a mixed case
    // For solid colors: all pixels == mean, so hash could be 0 for both.
    // Use a mixed image instead:
    const mixedPng = new PNG({ width: 8, height: 8 });
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (8 * y + x) << 2;
        // Left half dark, right half bright
        const val = x < 4 ? 50 : 200;
        mixedPng.data[idx] = val;
        mixedPng.data[idx + 1] = val;
        mixedPng.data[idx + 2] = val;
        mixedPng.data[idx + 3] = 255;
      }
    }
    const mixedBuf = PNG.sync.write(mixedPng);
    const hashMixed = await capture.perceptualHash(mixedBuf);
    // Mixed should differ from uniform
    const distance = capture.hammingDistance(hash1, hashMixed);
    expect(distance).toBeGreaterThan(0);
  });

  it('triggerBurst activates burst mode', () => {
    expect(capture.capturing).toBe(false);
    capture.triggerBurst('click');
    // Burst mode is internal — verify it emits a keyframe if lastFrameBuffer exists
    // Without a last frame, no emission
    const listener = vi.fn();
    capture.on('keyframe', listener);
    // No last frame → no emission on triggerBurst
    capture.triggerBurst('scroll');
    expect(listener).not.toHaveBeenCalled();
  });

  it('start/stop lifecycle works with mocked CDPSession', async () => {
    const mockCDP = {
      send: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    const mockPage = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue(mockCDP),
      }),
    } as any;

    await capture.start(mockPage);
    expect(capture.capturing).toBe(true);
    expect(mockCDP.send).toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));
    expect(mockCDP.on).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));

    await capture.stop();
    expect(capture.capturing).toBe(false);
    expect(mockCDP.send).toHaveBeenCalledWith('Page.stopScreencast');
  });
});
