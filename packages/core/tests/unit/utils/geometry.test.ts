import { describe, it, expect } from 'vitest';
import { computeIoU, boxArea, boxIntersection, isPointInBox, boxCenter } from '../../../src/utils/geometry.js';

const boxA = { x: 0, y: 0, width: 100, height: 100 };
const boxB = { x: 50, y: 50, width: 100, height: 100 };
const boxC = { x: 200, y: 200, width: 50, height: 50 };

describe('boxArea', () => {
  it('computes area correctly', () => {
    expect(boxArea(boxA)).toBe(10000);
    expect(boxArea({ x: 0, y: 0, width: 0, height: 0 })).toBe(0);
  });
});

describe('boxIntersection', () => {
  it('returns intersection area of overlapping boxes', () => {
    expect(boxIntersection(boxA, boxB)).toBe(2500); // 50x50
  });

  it('returns 0 for non-overlapping boxes', () => {
    expect(boxIntersection(boxA, boxC)).toBe(0);
  });
});

describe('computeIoU', () => {
  it('returns 1 for identical boxes', () => {
    expect(computeIoU(boxA, boxA)).toBe(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    expect(computeIoU(boxA, boxC)).toBe(0);
  });

  it('returns correct IoU for partial overlap', () => {
    // intersection = 50*50 = 2500
    // union = 10000 + 10000 - 2500 = 17500
    expect(computeIoU(boxA, boxB)).toBeCloseTo(2500 / 17500, 5);
  });
});

describe('isPointInBox', () => {
  it('returns true for point inside box', () => {
    expect(isPointInBox({ x: 50, y: 50 }, boxA)).toBe(true);
  });

  it('returns false for point outside box', () => {
    expect(isPointInBox({ x: 150, y: 150 }, boxA)).toBe(false);
  });
});

describe('boxCenter', () => {
  it('returns center coordinates', () => {
    expect(boxCenter(boxA)).toEqual({ x: 50, y: 50 });
  });
});
