import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { measuredDuration, fitEasing, detectFlashes, motionEnergy } from '../../../../src/dataset/recorder/measure.js';
import type { CapturedFrame } from '../../../../src/dataset/capture/screencast-recorder.js';

const W = 640, H = 360, MS = 1000 / 60;
const VIEWPORT = { width: W, height: H };

async function frame(i: number, bg: string, rect?: { x: number; w: number; h: number; color?: string }): Promise<CapturedFrame> {
  let img = sharp({ create: { width: W, height: H, channels: 3, background: bg } });
  if (rect) {
    const patch = await sharp({ create: { width: rect.w, height: rect.h, channels: 3, background: rect.color ?? '#000' } }).png().toBuffer();
    img = img.composite([{ input: patch, left: Math.round(rect.x), top: 100 }]);
  }
  return { ts: i * MS, jpeg: await img.jpeg({ quality: 95 }).toBuffer(), scrollX: 0, scrollY: 0 };
}

/** x(i) for i in [0,n); rectangle 120x120 on white. */
const movie = (n: number, x: (i: number) => number) =>
  Promise.all(Array.from({ length: n }, (_, i) => frame(i, '#fff', { x: x(i), w: 120, h: 120 })));

describe('measuredDuration', () => {
  it('measured_duration_spans_first_to_last_changed_frame', async () => {
    // Moves on frames 5..20, still before and after.
    const frames = await movie(30, (i) => 50 + 10 * Math.min(Math.max(i, 4), 20));
    const d = await measuredDuration(frames);
    expect(Math.abs((d as number) - 250)).toBeLessThanOrEqual(17);
  });
  it('returns null for static frames', async () => {
    expect(await measuredDuration(await movie(6, () => 50))).toBeNull();
  });
});

describe('fitEasing', () => {
  it('fit_easing_identifies_linear_motion', async () => {
    const frames = await movie(21, (i) => 20 + 20 * i);
    expect((await fitEasing(frames))!.curve).toBe('linear');
  });
  it('fit_easing_identifies_ease_out', async () => {
    // quadratic ease-out: position = 1 - (1-t)^2, per-frame step < rect width
    const frames = await movie(21, (i) => 20 + 400 * (1 - (1 - i / 20) ** 2));
    expect((await fitEasing(frames))!.curve).toBe('ease-out');
  });
  it('fit_easing_null_under_4_frames', async () => {
    expect(await fitEasing(await movie(3, (i) => 20 + 40 * i))).toBeNull();
  });
});

describe('detectFlashes', () => {
  it('black_white_full_frame_at_8hz_fails_wcag', async () => {
    // Flip every 4 frames at 60 fps = 7.5 Hz transitions -> ~7 flashes/s.
    const frames = await Promise.all(Array.from({ length: 60 }, (_, i) => frame(i, Math.floor(i / 4) % 2 ? '#fff' : '#000')));
    const r = await detectFlashes(frames, VIEWPORT);
    expect(r.general).toBeGreaterThan(3);
    expect(r.failsWcag231).toBe(true);
  });
  it('small_flashing_region_below_area_threshold_passes', async () => {
    const frames = await Promise.all(Array.from({ length: 60 }, (_, i) =>
      frame(i, '#fff', Math.floor(i / 4) % 2 ? undefined : { x: 10, w: 60, h: 40 })));
    const r = await detectFlashes(frames, VIEWPORT);
    expect(r.general).toBe(0);
    expect(r.failsWcag231).toBe(false);
  });
  it('static_frames_report_zero_flashes', async () => {
    const r = await detectFlashes(await movie(10, () => 50), VIEWPORT);
    expect(r).toEqual({ general: 0, red: 0, failsWcag231: false });
  });
  it('red_full_frame_flashing_counts_red', async () => {
    const frames = await Promise.all(Array.from({ length: 60 }, (_, i) => frame(i, Math.floor(i / 4) % 2 ? '#fff' : '#f00')));
    const r = await detectFlashes(frames, VIEWPORT);
    expect(r.red).toBeGreaterThan(3);
    expect(r.failsWcag231).toBe(true);
  });
});

describe('motionEnergy', () => {
  it('is zero for static frames and grows with motion', async () => {
    expect(await motionEnergy(await movie(5, () => 50))).toBe(0);
    expect(await motionEnergy(await movie(5, (i) => 50 + 30 * i))).toBeGreaterThan(0);
  });
});
