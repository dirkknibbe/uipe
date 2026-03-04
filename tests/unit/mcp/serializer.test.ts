import { describe, it, expect } from 'vitest';
import { affordanceToText } from '../../../src/mcp/serializer.js';
import type { AffordanceMap, Affordance } from '../../../src/types/index.js';

function makeMap(entries: Affordance[]): AffordanceMap {
  return new Map(entries.map(a => [a.nodeId, a]));
}

function makeAffordance(
  nodeId: string,
  priority: Affordance['priority'],
  confidence = 0.8,
  sideEffects?: string[],
): Affordance {
  return {
    nodeId,
    priority,
    predictions: [{
      action: 'clickable',
      predictedOutcome: `${priority} action outcome`,
      confidence,
      sideEffects,
    }],
  };
}

describe('affordanceToText', () => {
  it('empty map → "No affordances" message', () => {
    expect(affordanceToText(new Map())).toMatch(/no affordances/i);
  });

  it('entries sorted high before medium before low', () => {
    const map = makeMap([
      makeAffordance('low-node', 'low'),
      makeAffordance('high-node', 'high'),
      makeAffordance('med-node', 'medium'),
    ]);
    const text = affordanceToText(map, 'low');
    expect(text.indexOf('high-node')).toBeLessThan(text.indexOf('med-node'));
    expect(text.indexOf('med-node')).toBeLessThan(text.indexOf('low-node'));
  });

  it('minPriority="high" excludes medium and low entries', () => {
    const map = makeMap([
      makeAffordance('h', 'high'),
      makeAffordance('m', 'medium'),
      makeAffordance('l', 'low'),
    ]);
    const text = affordanceToText(map, 'high');
    expect(text).toContain('[HIGH]');
    expect(text).not.toContain('[MEDIUM]');
    expect(text).not.toContain('[LOW]');
  });

  it('each entry contains nodeId, outcome, action, and formatted confidence', () => {
    const map = makeMap([makeAffordance('btn1', 'high', 0.75)]);
    const text = affordanceToText(map, 'high');
    expect(text).toContain('btn1');
    expect(text).toContain('high action outcome');
    expect(text).toContain('clickable');
    expect(text).toContain('confidence=0.75');
  });

  it('sideEffects rendered when present', () => {
    const map = makeMap([makeAffordance('btn1', 'high', 0.65, ['modal_open'])]);
    const text = affordanceToText(map, 'high');
    expect(text).toContain('modal_open');
    expect(text).toContain('side effect');
  });
});
