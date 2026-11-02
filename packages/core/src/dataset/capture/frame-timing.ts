import type { Page, CDPSession } from 'playwright';
import type { FrameTimingSummary } from '../types.js';

export type { FrameTimingSummary };
export interface TraceEvent { name: string; cat: string; ph: string; ts: number; dur?: number; args?: Record<string, unknown> }

const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame'];
const GAP_FACTOR = 1.5;
export const SYNC_MARK = 'uipe-sync';

export class FrameTimingRecorder {
  private cdp?: CDPSession;
  private events: TraceEvent[] = [];
  /** Wall-clock ms at which the SYNC_MARK TimeStamp was emitted into the current trace. */
  syncWallMs: number | null = null;

  constructor(private page: Page) {}

  async start(): Promise<void> {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
      // Registered once: the Recorder restarts tracing at every episode boundary (R3).
      this.cdp.on('Tracing.dataCollected', (p: any) => { this.events.push(...(p.value as TraceEvent[])); });
    }
    this.events = [];
    this.syncWallMs = null;
    await this.cdp.send('Tracing.start', { traceConfig: { includedCategories: CATEGORIES }, transferMode: 'ReportEvents' } as any);
    // Trace ts sit on Chromium's TimeTicks base, which no page or stream clock shares; a TimeStamp
    // event emitted at a known wall time anchors it. A string, so tsx never rewrites it.
    const before = Date.now();
    try {
      await this.page.evaluate(`console.timeStamp('${SYNC_MARK}')`);
      this.syncWallMs = (before + Date.now()) / 2;
    } catch {
      this.syncWallMs = null; // page mid-navigation: this window has no anchor, so no frame timing
    }
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

/** Re-time trace events to wall-clock µs via the SYNC_MARK event; null when the trace has no anchor. */
export function toWallClockUs(events: TraceEvent[], syncWallMs: number | null): TraceEvent[] | null {
  const mark = events.find((e) => e.name === 'TimeStamp' && (e.args?.data as { message?: string } | undefined)?.message === SYNC_MARK);
  if (!mark || syncWallMs === null) return null;
  const offsetUs = syncWallMs * 1000 - mark.ts;
  return events.map((e) => ({ ...e, ts: e.ts + offsetUs }));
}
