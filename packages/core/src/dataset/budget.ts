export interface BudgetCaps { maxSteps: number; maxUsd: number; maxWallMs: number }

export const DEFAULT_CAPS: BudgetCaps = { maxSteps: 60, maxUsd: 2.0, maxWallMs: 1_200_000 };

export class RunBudget {
  private steps = 0;
  private usd = 0;
  private readonly startedAt: number;

  constructor(private readonly caps: BudgetCaps, private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  recordStep(usd: number): void {
    this.steps += 1;
    this.usd += usd;
  }

  exceeded(): null | 'steps' | 'usd' | 'wall' {
    if (this.steps >= this.caps.maxSteps) return 'steps';
    if (this.usd >= this.caps.maxUsd) return 'usd';
    if (this.now() - this.startedAt >= this.caps.maxWallMs) return 'wall';
    return null;
  }

  snapshot(): { steps: number; usd: number; elapsedMs: number } {
    return { steps: this.steps, usd: this.usd, elapsedMs: this.now() - this.startedAt };
  }
}
