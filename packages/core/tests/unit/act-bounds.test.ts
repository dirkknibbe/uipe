import { describe, it, expect } from 'vitest';
import { actInputSchema } from '../../src/mcp/act-schema.js';

describe('act input bounds', () => {
  it('rejects ms beyond the ceiling', () => {
    expect(actInputSchema.safeParse({ type: 'wait', ms: 2_147_483_647 }).success).toBe(false);
  });

  it('accepts a sane wait', () => {
    expect(actInputSchema.safeParse({ type: 'wait', ms: 1000 }).success).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    expect(actInputSchema.safeParse({ type: 'click', x: Infinity, y: 0 }).success).toBe(false);
    expect(actInputSchema.safeParse({ type: 'click', x: NaN, y: 0 }).success).toBe(false);
  });

  it('accepts a normal click', () => {
    expect(actInputSchema.safeParse({ type: 'click', x: 10, y: 20 }).success).toBe(true);
  });
});
