import sharp from 'sharp';
import type { CapturedFrame } from '../capture/screencast-recorder.js';
import type { FlashResult, Measurements } from '../types.js';

export type { FlashResult };
export type EasingFit = NonNullable<Measurements['fittedEasing']>;

const DIFF_WIDTH = 320;
const PIXEL_DIFF_SUM = 24; // summed |dR|+|dG|+|dB| above this counts as changed (absorbs JPEG noise)
const DEFAULT_CHANGE_THRESHOLD = 0.002;
const MIN_EASING_FRAMES = 4;
const LUM_DELTA = 0.1;
const LUM_DARK_MAX = 0.8;
const RED_RATIO = 0.8;
const AREA_FRACTION = 21_824 / (1024 * 768); // WCAG 2.3.1 general-flash area, scaled by viewport
const MAX_FLASHES_PER_SECOND = 3;

interface Raw { data: Buffer; pixels: number }

async function decode(frames: CapturedFrame[]): Promise<Raw[]> {
  return Promise.all(frames.map(async (f) => {
    const { data, info } = await sharp(f.jpeg).resize({ width: DIFF_WIDTH, withoutEnlargement: true })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, pixels: info.width * info.height };
  }));
}

function changedFraction(a: Raw, b: Raw): number {
  const n = Math.min(a.data.length, b.data.length);
  let changed = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > PIXEL_DIFF_SUM) changed++;
  }
  return changed / Math.min(a.pixels, b.pixels);
}

/** diffs[i] = changed fraction between frame i and i+1 */
async function frameDiffs(frames: CapturedFrame[]): Promise<number[]> {
  const raws = await decode(frames);
  return raws.slice(1).map((r, i) => changedFraction(raws[i], r));
}

/** Sum of per-frame changed-pixel fractions (ruling R5). */
export async function motionEnergy(frames: CapturedFrame[]): Promise<number> {
  return (await frameDiffs(frames)).reduce((s, d) => s + d, 0);
}

function changedSpan(diffs: number[], threshold: number): [number, number] | null {
  const first = diffs.findIndex((d) => d > threshold);
  if (first < 0) return null;
  let last = first;
  diffs.forEach((d, i) => { if (d > threshold) last = i; });
  return [first, last];
}

/** First changed frame to last changed frame, in ms. */
export async function measuredDuration(frames: CapturedFrame[], changeThreshold = DEFAULT_CHANGE_THRESHOLD): Promise<number | null> {
  if (frames.length < 2) return null;
  const span = changedSpan(await frameDiffs(frames), changeThreshold);
  return span ? frames[span[1] + 1].ts - frames[span[0] + 1].ts : null;
}

const BEZIERS: Record<EasingFit['curve'], [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

function bezierY(x: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const at = (s: number, a: number, b: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, x1, x2) < x) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2, y1, y2);
}

/** Fits cumulative frame-difference progress vs normalized time to the CSS easing keywords. */
export async function fitEasing(frames: CapturedFrame[]): Promise<EasingFit | null> {
  if (frames.length < MIN_EASING_FRAMES) return null;
  const diffs = await frameDiffs(frames);
  const span = changedSpan(diffs, DEFAULT_CHANGE_THRESHOLD);
  if (!span) return null;
  const motion = diffs.slice(span[0], span[1] + 1);
  const total = motion.reduce((s, d) => s + d, 0);
  if (motion.length < MIN_EASING_FRAMES - 1 || total === 0) return null;
  const n = motion.length;
  let cum = 0;
  const pts = [{ t: 0, p: 0 }, ...motion.map((d, i) => ({ t: (i + 1) / n, p: (cum += d) / total }))];
  let best: EasingFit | null = null;
  for (const curve of Object.keys(BEZIERS) as EasingFit['curve'][]) {
    const sse = pts.reduce((s, { t, p }) => s + (bezierY(t, BEZIERS[curve]) - p) ** 2, 0);
    const rmse = Math.sqrt(sse / pts.length);
    if (!best || rmse < best.rmse) best = { curve, rmse };
  }
  return best;
}

function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** +1 / -1 for the net direction of a frame pair's change, 0 if its area is below the threshold. */
function pairDirections(a: Raw, b: Raw, minFraction: number, red: boolean): number {
  const n = Math.min(a.data.length, b.data.length);
  let up = 0, down = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    if (red) {
      const wasRed = isRed(a.data, i), isNowRed = isRed(b.data, i);
      if (isNowRed && !wasRed) up++; else if (wasRed && !isNowRed) down++;
      continue;
    }
    const la = luminance(a.data[i], a.data[i + 1], a.data[i + 2]);
    const lb = luminance(b.data[i], b.data[i + 1], b.data[i + 2]);
    if (Math.abs(lb - la) >= LUM_DELTA && Math.min(la, lb) < LUM_DARK_MAX) { if (lb > la) up++; else down++; }
  }
  if ((up + down) / Math.min(a.pixels, b.pixels) < minFraction) return 0;
  return up >= down ? 1 : -1;
}

function isRed(d: Buffer, i: number): boolean {
  const sum = d[i] + d[i + 1] + d[i + 2];
  return sum > 0 && d[i] / sum >= RED_RATIO;
}

/** Flashes (pairs of opposing changes) in the worst 1 s window. */
function worstFlashes(events: { ts: number; dir: number }[]): number {
  // Consecutive same-direction transitions are one continuing change.
  const changes = events.filter((e, i) => i === 0 || e.dir !== events[i - 1].dir);
  let worst = 0;
  for (let i = 0; i < changes.length; i++) {
    const inWindow = changes.filter((c) => c.ts >= changes[i].ts && c.ts < changes[i].ts + 1000).length;
    worst = Math.max(worst, Math.floor(inWindow / 2));
  }
  return worst;
}

export async function detectFlashes(frames: CapturedFrame[], _viewport: { width: number; height: number }): Promise<FlashResult> {
  // The area rule is a fraction of the viewport, so it is resolution-independent after downscaling.
  const raws = await decode(frames);
  const scan = (red: boolean) => worstFlashes(
    raws.slice(1).map((r, i) => ({ ts: frames[i + 1].ts, dir: pairDirections(raws[i], r, AREA_FRACTION, red) })).filter((e) => e.dir !== 0));
  const general = scan(false), red = scan(true);
  return { general, red, failsWcag231: general > MAX_FLASHES_PER_SECOND || red > MAX_FLASHES_PER_SECOND };
}
