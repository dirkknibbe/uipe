import { describe, it, expect } from 'vitest';
import { computeDeviation, SCALE } from '../../../../../../src/pipelines/temporal/verifiers/animation/deviation.js';
import type { PropertyPrediction } from '../../../../../../src/pipelines/temporal/collectors/types.js';

describe('SCALE constants', () => {
  it('defines a scale for every SupportedProperty', () => {
    expect(SCALE.translateX).toBe(50);
    expect(SCALE.translateY).toBe(50);
    expect(SCALE.scale).toBe(0.25);
    expect(SCALE.rotate).toBeCloseTo(0.5, 5);
    expect(SCALE.opacity).toBe(0.2);
    expect(SCALE.width).toBe(50);
    expect(SCALE.height).toBe(50);
    expect(SCALE.top).toBe(50);
    expect(SCALE.left).toBe(50);
    expect(SCALE.right).toBe(50);
    expect(SCALE.bottom).toBe(50);
  });
});

describe('computeDeviation', () => {
  const predicted: PropertyPrediction[] = [
    { property: 'translateX', endValue: 100, unit: 'px' },
    { property: 'opacity', endValue: 1, unit: 'scalar' },
  ];

  it('returns zero deviation when observed matches predicted exactly', () => {
    const dev = computeDeviation(predicted, { translateX: 100, opacity: 1 });
    expect(dev.score).toBe(0);
    expect(dev.perProperty).toHaveLength(2);
    for (const p of dev.perProperty) {
      expect(p.delta).toBe(0);
      expect(p.normalizedDelta).toBe(0);
    }
  });

  it('computes per-property delta as observed minus predicted', () => {
    const dev = computeDeviation(predicted, { translateX: 105, opacity: 0.9 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    const op = dev.perProperty.find((p) => p.property === 'opacity')!;
    expect(tx.delta).toBe(5);
    expect(op.delta).toBeCloseTo(-0.1, 5);
  });

  it('normalizes delta against SCALE per property', () => {
    const dev = computeDeviation(predicted, { translateX: 150, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.normalizedDelta).toBeCloseTo(50 / 50, 5);
  });

  it('clamps normalizedDelta to [0, 1]', () => {
    const dev = computeDeviation(predicted, { translateX: 10000, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.normalizedDelta).toBe(1);
  });

  it('takes absolute value of delta for normalization', () => {
    const dev = computeDeviation(predicted, { translateX: -50, opacity: 1 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    expect(tx.delta).toBe(-150);
    expect(tx.normalizedDelta).toBe(1);
  });

  it('score is max of per-property normalizedDelta', () => {
    const dev = computeDeviation(predicted, { translateX: 105, opacity: 0.5 });
    const tx = dev.perProperty.find((p) => p.property === 'translateX')!;
    const op = dev.perProperty.find((p) => p.property === 'opacity')!;
    expect(dev.score).toBe(Math.max(tx.normalizedDelta, op.normalizedDelta));
  });

  it('drops predicted properties missing from observed (does not penalize)', () => {
    const dev = computeDeviation(predicted, { translateX: 100 });
    expect(dev.perProperty).toHaveLength(1);
    expect(dev.perProperty[0].property).toBe('translateX');
  });

  it('returns score=0 with empty perProperty when predicted is empty', () => {
    const dev = computeDeviation([], { translateX: 100 });
    expect(dev.score).toBe(0);
    expect(dev.perProperty).toHaveLength(0);
  });
});
