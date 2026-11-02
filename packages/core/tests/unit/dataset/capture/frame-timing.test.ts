import { describe, it, expect, vi } from 'vitest';
import type { Page, CDPSession } from 'playwright';
import { summarizeFrameTiming, FrameTimingRecorder, toWallClockUs, type TraceEvent } from '../../../../src/dataset/capture/frame-timing.js';
import { readFileSync } from 'node:fs';

const sample: TraceEvent[] = JSON.parse(readFileSync(new URL('./fixtures/trace-sample.json', import.meta.url), 'utf8'));

describe('summarizeFrameTiming', () => {
  it('summarize_counts_dropped_frames_in_window_only', () => {
    const s = summarizeFrameTiming(sample, 1_000_000, 2_000_000);
    expect(s.droppedFrames).toBe(2);
    expect(s.frames).toBeGreaterThan(50);
    expect(s.source).toBe('trace');
  });
  it('counts DrawFrame gaps above 1.5x median as drops', () => {
    const ev: TraceEvent[] = [0, 16000, 32000, 48000, 120000, 136000].map((ts) => ({ name: 'DrawFrame', cat: 'c', ph: 'I', ts }));
    const s = summarizeFrameTiming(ev, 0, 200_000);
    expect(s.droppedFrames).toBe(1);
    expect(s.longestFrameMs).toBe(72);
  });
  it('summarize_on_empty_events_returns_zero_frames_not_throw', () => {
    expect(summarizeFrameTiming([], 0, 1000)).toEqual({ frames: 0, droppedFrames: 0, longestFrameMs: 0, longAnimationFrames: 0, source: 'trace' });
  });
});

describe('FrameTimingRecorder', () => {
  it('collects events from Tracing.dataCollected until tracingComplete', async () => {
    const handlers = new Map<string, Function>();
    const cdp = {
      send: vi.fn(async (m: string) => {
        if (m === 'Tracing.end') {
          handlers.get('Tracing.dataCollected')!({ value: [{ name: 'DrawFrame', cat: 'c', ph: 'I', ts: 1 }] });
          handlers.get('Tracing.tracingComplete')!({});
        }
      }),
      on: vi.fn((e: string, h: Function) => handlers.set(e, h)),
      once: vi.fn((e: string, h: Function) => handlers.set(e, h)),
      off: vi.fn(),
      detach: vi.fn(async () => undefined),
    } as unknown as CDPSession;
    const evaluate = vi.fn(async () => undefined);
    const page = { context: () => ({ newCDPSession: async () => cdp }), evaluate } as unknown as Page;
    const r = new FrameTimingRecorder(page);
    const before = Date.now();
    await r.start();
    expect(evaluate).toHaveBeenCalledWith("console.timeStamp('uipe-sync')");
    expect(r.syncWallMs).toBeGreaterThanOrEqual(before);
    expect(r.syncWallMs).toBeLessThanOrEqual(Date.now());
    const events = await r.stopAndCollect();
    expect(events).toHaveLength(1);
    expect((cdp.send as any).mock.calls[0][1].traceConfig.includedCategories)
      .toEqual(['devtools.timeline', 'disabled-by-default-devtools.timeline.frame']);
  });
});

describe('toWallClockUs', () => {
  const mark = (ts: number): TraceEvent => ({ name: 'TimeStamp', cat: 'devtools.timeline', ph: 'I', ts, args: { data: { message: 'uipe-sync' } } });
  it('shifts TimeTicks µs so the sync marker lands on its wall time', () => {
    const out = toWallClockUs([mark(4_170_400_000_000), { name: 'DrawFrame', cat: 'c', ph: 'I', ts: 4_170_400_016_000 }], 1_700_000_000_000)!;
    expect(out.map((e) => e.ts)).toEqual([1_700_000_000_000_000, 1_700_000_000_016_000]);
  });
  it('returns null without a marker or a recorded sync time', () => {
    expect(toWallClockUs([{ name: 'DrawFrame', cat: 'c', ph: 'I', ts: 1 }], 5)).toBeNull();
    expect(toWallClockUs([mark(1)], null)).toBeNull();
  });
});
