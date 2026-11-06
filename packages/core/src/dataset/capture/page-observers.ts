import type { Page } from 'playwright';

export const PAGE_OBSERVERS_SCRIPT = `
(() => {
  if (window.__uipePerf) return;
  const perf = { loaf: [], shifts: [] };
  window.__uipePerf = perf;
  const watch = (type, fn) => {
    try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) {}
  };
  watch('long-animation-frame', (e) => perf.loaf.push(e.startTime));
  watch('layout-shift', (e) => { if (!e.hadRecentInput) perf.shifts.push([e.startTime, e.value]); });
})();
`;

export function readPageObservers(page: Page, sinceMs: number): Promise<{ longAnimationFrames: number; layoutShift: number }> {
  return page.evaluate((since: number) => {
    const p = (window as any).__uipePerf;
    if (!p) return { longAnimationFrames: 0, layoutShift: 0 };
    return {
      longAnimationFrames: p.loaf.filter((t: number) => t >= since).length,
      layoutShift: p.shifts.filter((s: number[]) => s[0] >= since).reduce((a: number, s: number[]) => a + s[1], 0),
    };
  }, sinceMs);
}
