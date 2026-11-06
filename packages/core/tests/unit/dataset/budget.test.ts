import { describe, it, expect } from 'vitest';
import { RunBudget, DEFAULT_CAPS } from '../../../src/dataset/budget.js';

describe('RunBudget', () => {
  it('has the spec default caps', () => {
    expect(DEFAULT_CAPS).toEqual({ maxSteps: 60, maxUsd: 2.0, maxWallMs: 1_200_000 });
  });

  it('exceeded_reports_first_cap_hit', () => {
    let t = 0;
    const b = new RunBudget({ maxSteps: 2, maxUsd: 1, maxWallMs: 100 }, () => t);
    expect(b.exceeded()).toBeNull();
    b.recordStep(0.2);
    expect(b.exceeded()).toBeNull();
    b.recordStep(0.2);
    expect(b.exceeded()).toBe('steps');

    const u = new RunBudget({ maxSteps: 10, maxUsd: 1, maxWallMs: 100 }, () => t);
    u.recordStep(1);
    expect(u.exceeded()).toBe('usd');

    const w = new RunBudget({ maxSteps: 10, maxUsd: 1, maxWallMs: 100 }, () => t);
    t = 100;
    expect(w.exceeded()).toBe('wall');
    expect(w.snapshot()).toEqual({ steps: 0, usd: 0, elapsedMs: 100 });
  });
});
