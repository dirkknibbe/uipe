import { describe, it, expect } from 'vitest';
import {
  detectMutationOutsideAnimation,
  type MutationRecord,
} from '../../../../../src/pipelines/perception/anomaly/mutation-outside-animation.js';

function mkMutation(timestamp: number, targetNodeId: string): MutationRecord {
  return { timestamp, targetNodeId };
}

const DEFAULTS = { lookbackMs: 200, coalesceWindowMs: 100, warmupMs: 500 };

describe('detectMutationOutsideAnimation', () => {
  it('returns null during warmup window', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(100, 'a')],
      activeAnimations: new Set(),
      nowMs: 400,            // 400 - 0 = 400 < 500ms warmup
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns null when any animation is active', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(900, 'a')],
      activeAnimations: new Set(['anim-1']),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns null when no mutations', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toBeNull();
  });

  it('returns result when past warmup + no animation + has mutations', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(950, 'a'), mkMutation(960, 'b')],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 2,
      targetNodeIds: ['a', 'b'],
    });
  });

  it('coalesces mutations within the coalesce window into one burst', () => {
    // Three mutations at 900, 950, 990 — gaps 50ms and 40ms, both ≤ 100ms coalesce
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(900, 'a'),
        mkMutation(950, 'b'),
        mkMutation(990, 'c'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 3,
      targetNodeIds: ['a', 'b', 'c'],
    });
  });

  it('takes only the latest burst when multiple non-overlapping bursts exist', () => {
    // Burst A: 600-650 (older). Burst B: 950-990 (latest). Gap = 300ms > coalesce.
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(600, 'old1'),
        mkMutation(650, 'old2'),
        mkMutation(950, 'new1'),
        mkMutation(990, 'new2'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({
      mutationCount: 2,
      targetNodeIds: ['new1', 'new2'],
    });
  });

  it('deduplicates target node IDs', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [
        mkMutation(900, 'a'),
        mkMutation(920, 'a'),     // same node mutated twice
        mkMutation(950, 'b'),
      ],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result?.targetNodeIds).toEqual(['a', 'b']);
    // mutationCount counts the events; targetNodeIds is deduped
    expect(result?.mutationCount).toBe(3);
  });

  it('treats a single mutation as a one-event burst', () => {
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(950, 'a')],
      activeAnimations: new Set(),
      nowMs: 1000,
      sessionStartMs: 0,
    }, DEFAULTS);
    expect(result).toEqual({ mutationCount: 1, targetNodeIds: ['a'] });
  });

  it('uses provided config over defaults', () => {
    // Override warmup to 0 → no suppression
    const result = detectMutationOutsideAnimation({
      recentMutations: [mkMutation(100, 'a')],
      activeAnimations: new Set(),
      nowMs: 200,
      sessionStartMs: 0,
    }, { lookbackMs: 200, coalesceWindowMs: 100, warmupMs: 0 });
    expect(result).toEqual({ mutationCount: 1, targetNodeIds: ['a'] });
  });
});
