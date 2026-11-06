import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { PAGE_OBSERVERS_SCRIPT, readPageObservers } from '../../../../src/dataset/capture/page-observers.js';

describe('page observers', () => {
  it('page_observers_script_is_idempotent (guard flag)', () => {
    expect(PAGE_OBSERVERS_SCRIPT).toContain('if (window.__uipePerf) return');
    const w: any = { PerformanceObserver: class { observe() {} }, performance: { now: () => 0 } };
    const run = () => new Function('window', 'PerformanceObserver', PAGE_OBSERVERS_SCRIPT)(w, w.PerformanceObserver);
    run();
    const first = w.__uipePerf;
    run();
    expect(w.__uipePerf).toBe(first);
  });
  it('readPageObservers passes sinceMs and returns the result', async () => {
    const page = { evaluate: vi.fn(async () => ({ longAnimationFrames: 2, layoutShift: 0.1 })) } as unknown as Page;
    expect(await readPageObservers(page, 500)).toEqual({ longAnimationFrames: 2, layoutShift: 0.1 });
    expect((page.evaluate as any).mock.calls[0][1]).toBe(500);
  });
});
