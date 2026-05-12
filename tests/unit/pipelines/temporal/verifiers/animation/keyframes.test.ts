import { describe, it, expect } from 'vitest';
import { parseRawKeyframes } from '../../../../../../src/pipelines/temporal/verifiers/animation/keyframes.js';

describe('parseRawKeyframes', () => {
  it('extracts translateX from a transform string', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 1, transform: 'translateX(240px)' },
    ]);
    expect(result.unsupportedProperties).toEqual([]);
    expect(result.keyframes).toEqual([
      { offset: 0, properties: { translateX: 0 } },
      { offset: 1, properties: { translateX: 240 } },
    ]);
  });

  it('decomposes composite transform into multiple components', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px) translateY(0px) scale(1) rotate(0deg)' },
      { offset: 1, transform: 'translateX(100px) translateY(50px) scale(1.5) rotate(45deg)' },
    ]);
    expect(result.keyframes[1].properties).toEqual({
      translateX: 100,
      translateY: 50,
      scale: 1.5,
      rotate: 45 * Math.PI / 180,
    });
  });

  it('keeps each keyframe independent (no cross-keyframe defaulting)', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 1, transform: 'translateX(100px) scale(1.5)' },
    ]);
    expect(result.keyframes[0].properties).toEqual({ translateX: 0 });
    expect(result.keyframes[1].properties).toEqual({ translateX: 100, scale: 1.5 });
  });

  it('parses opacity as a scalar', () => {
    const result = parseRawKeyframes([
      { offset: 0, opacity: '0' },
      { offset: 1, opacity: '1' },
    ]);
    expect(result.keyframes[1].properties).toEqual({ opacity: 1 });
  });

  it('parses width/height/top/left as pixel values', () => {
    const result = parseRawKeyframes([
      { offset: 0, width: '100px', height: '50px', top: '10px', left: '20px' },
      { offset: 1, width: '300px', height: '150px', top: '40px', left: '60px' },
    ]);
    expect(result.keyframes[1].properties).toEqual({
      width: 300,
      height: 150,
      top: 40,
      left: 60,
    });
  });

  it('routes Tier-3 properties to unsupportedProperties', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)', backgroundColor: 'rgb(255, 0, 0)' },
      { offset: 1, transform: 'translateX(100px)', backgroundColor: 'rgb(0, 255, 0)' },
    ]);
    expect(result.unsupportedProperties).toContain('backgroundColor');
    expect(result.keyframes[1].properties).toEqual({ translateX: 100 });
  });

  it('handles rotate in radians', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'rotate(0rad)' },
      { offset: 1, transform: 'rotate(1.5708rad)' },
    ]);
    expect(result.keyframes[1].properties.rotate).toBeCloseTo(1.5708, 4);
  });

  it('handles rotate in turn units', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'rotate(0turn)' },
      { offset: 1, transform: 'rotate(0.5turn)' },
    ]);
    expect(result.keyframes[1].properties.rotate).toBeCloseTo(Math.PI, 4);
  });

  it('returns empty keyframes for empty input', () => {
    const result = parseRawKeyframes([]);
    expect(result.keyframes).toEqual([]);
    expect(result.unsupportedProperties).toEqual([]);
  });

  it('routes filter, clipPath, color to unsupportedProperties', () => {
    const result = parseRawKeyframes([
      { offset: 0, filter: 'blur(0px)', clipPath: 'inset(0%)', color: 'rgb(0, 0, 0)' },
      { offset: 1, filter: 'blur(5px)', clipPath: 'inset(10%)', color: 'rgb(255, 255, 255)' },
    ]);
    expect(result.unsupportedProperties).toEqual(expect.arrayContaining(['filter', 'clipPath', 'color']));
    expect(result.keyframes[1].properties).toEqual({});
  });

  it('preserves the input offset values', () => {
    const result = parseRawKeyframes([
      { offset: 0, transform: 'translateX(0px)' },
      { offset: 0.5, transform: 'translateX(50px)' },
      { offset: 1, transform: 'translateX(100px)' },
    ]);
    expect(result.keyframes).toHaveLength(3);
    expect(result.keyframes[1].offset).toBe(0.5);
  });
});
