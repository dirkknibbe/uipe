import { describe, it, expect } from 'vitest';
import { valueAtFinalState, type NormalizedKeyframe } from '../../../../../../src/pipelines/temporal/verifiers/animation/interpolation.js';

const kfFromTo = (from: Record<string, number>, to: Record<string, number>): NormalizedKeyframe[] => ([
  { offset: 0, properties: from },
  { offset: 1, properties: to },
]);

describe('valueAtFinalState', () => {
  it('returns the to-state for iterations:1 direction:normal', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ translateX: 240 });
  });

  it('returns the to-state even with non-linear easing (easing is offset=1 invariant)', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { opacity: 0 } },
        { offset: 1, properties: { opacity: 1 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ opacity: 1 });
  });

  it('returns null for direction:reverse', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 1, direction: 'reverse' },
    );
    expect(result).toBeNull();
  });

  it('returns null for direction:alternate', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 2, direction: 'alternate' },
    );
    expect(result).toBeNull();
  });

  it('returns null for iterations !== 1 even with normal direction', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: 3, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns null for iterations: Infinity', () => {
    const result = valueAtFinalState(
      kfFromTo({ translateX: 0 }, { translateX: 240 }),
      { iterations: Infinity, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns null when no keyframe at offset=1 exists', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { translateX: 0 } },
        { offset: 0.5, properties: { translateX: 100 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toBeNull();
  });

  it('returns the offset=1 keyframe when multiple are present', () => {
    const result = valueAtFinalState(
      [
        { offset: 0, properties: { translateX: 0 } },
        { offset: 1, properties: { translateX: 240 } },
      ],
      { iterations: 1, direction: 'normal' },
    );
    expect(result).toEqual({ translateX: 240 });
  });
});
