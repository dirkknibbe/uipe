import type { Page, CDPSession } from 'playwright';
import type { FrameTimingSummary } from '../types.js';

export type { FrameTimingSummary };
export interface TraceEvent { name: string; cat: string; ph: string; ts: number; dur?: number; args?: Record<string, unknown> }

const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame'];
const GAP_FACTOR = 1.5;

export class FrameTimingRecorder {
  private cdp?: CDPSession;
  private events: TraceEvent[] = [];

  constructor(private page: Page) {}

  async start(): Promise<void> {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
      // Registered once: the Recorder restarts tracing at every episode boundary (R3).
      this.cdp.on('Tracing.dataCollected', (p: any) => { this.events.push(...(p.value as TraceEvent[])); });
    }
    this.events = [];
    await this.cdp.send('Tracing.start', { traceConfig: { includedCategories: CATEGORIES }, transferMode: 'ReportEvents' } as any);
  }

  async stopAndCollect(): Promise<TraceEvent[]> {
    const cdp = this.cdp;
    if (!cdp) return [];
    const done = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end');
    await done;
    return this.events;
  }
}

/** longAnimationFrames is 0 here: LoAF comes from the page observers, not the trace. */
export function summarizeFrameTiming(events: TraceEvent[], startUs: number, endUs: number): FrameTimingSummary {
  const inWin = events.filter((e) => e.ts >= startUs && e.ts <= endUs);
  const draws = inWin.filter((e) => e.name === 'DrawFrame').map((e) => e.ts).sort((a, b) => a - b);
  let dropped = inWin.filter((e) => e.name === 'DroppedFrame').length;
  const intervals = draws.slice(1).map((t, i) => t - draws[i]);
  let longest = 0;
  if (intervals.length) {
    const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
    for (const iv of intervals) {
      if (iv > GAP_FACTOR * median) dropped++;
      longest = Math.max(longest, iv);
    }
  }
  return { frames: draws.length, droppedFrames: dropped, longestFrameMs: longest / 1000, longAnimationFrames: 0, source: 'trace' };
}
