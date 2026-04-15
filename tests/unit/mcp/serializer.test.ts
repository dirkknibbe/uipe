import { describe, it, expect } from 'vitest';
import { affordanceToText, formatVisualAnalysis } from '../../../src/mcp/serializer.js';
import type { AffordanceMap, Affordance, VisualUnderstanding } from '../../../src/types/index.js';

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

describe('formatVisualAnalysis (null-safe)', () => {
  // Regression for: "MCP error -32000: Connection closed" on first analyze_visual
  // call. Local vision models (llava:7b, qwen3-vl) frequently return partial
  // JSON that does not actually match VisualUnderstanding. Rendering must never
  // throw, no matter how mangled the payload is.

  it('renders a fully-valid analysis', () => {
    const analysis: VisualUnderstanding = {
      visualHierarchy: { primaryFocus: 'hero', readingFlow: ['nav', 'hero', 'cta'] },
      contrastIssues: [{ element: 'button', issue: 'low contrast', estimatedRatio: '2.1:1' }],
      spacingIssues: [{ area: 'footer', issue: 'cramped' }],
      affordanceIssues: [{ element: 'icon', issue: 'not obviously clickable' }],
      stateIndicators: [{ type: 'loading', element: 'spinner', description: 'visible' }],
      overallAssessment: 'OK',
    };
    const text = formatVisualAnalysis(analysis);
    expect(text).toContain('primary focus = "hero"');
    expect(text).toContain('nav → hero → cta');
    expect(text).toContain('ratio: 2.1:1');
    expect(text).toContain('Overall: OK');
  });

  it('does not throw when visualHierarchy is null', () => {
    const partial = {
      visualHierarchy: null,
      contrastIssues: [],
      spacingIssues: [],
      affordanceIssues: [],
      stateIndicators: [],
      overallAssessment: 'x',
    } as unknown as VisualUnderstanding;
    expect(() => formatVisualAnalysis(partial)).not.toThrow();
    expect(formatVisualAnalysis(partial)).toContain('primary focus = "unknown"');
  });

  it('does not throw when issue arrays contain null entries (common llava quirk)', () => {
    const partial = {
      visualHierarchy: { primaryFocus: 'x', readingFlow: [] },
      contrastIssues: [null, { element: 'btn', issue: 'low' }],
      spacingIssues: [null],
      affordanceIssues: [null, null],
      stateIndicators: [null],
      overallAssessment: 'ok',
    } as unknown as VisualUnderstanding;
    expect(() => formatVisualAnalysis(partial)).not.toThrow();
    const text = formatVisualAnalysis(partial);
    // null entries should be stripped, so counts reflect only real entries
    expect(text).toContain('Contrast Issues (1):');
    expect(text).toContain('btn: low');
  });

  it('does not throw when issue arrays contain entries with null/missing fields', () => {
    const partial = {
      visualHierarchy: { primaryFocus: 'x', readingFlow: ['a', null, 'b'] },
      contrastIssues: [{ element: null, issue: null, estimatedRatio: null }],
      spacingIssues: [{ area: undefined, issue: undefined }],
      affordanceIssues: [{}],
      stateIndicators: [{ type: null, element: null, description: null }],
      overallAssessment: null,
    } as unknown as VisualUnderstanding;
    expect(() => formatVisualAnalysis(partial)).not.toThrow();
    const text = formatVisualAnalysis(partial);
    expect(text).toContain('No assessment available');
    // non-string readingFlow entries are filtered out
    expect(text).toContain('a → b');
  });

  it('does not throw on an empty object (worst-case llava OOM partial response)', () => {
    const partial = {} as unknown as VisualUnderstanding;
    expect(() => formatVisualAnalysis(partial)).not.toThrow();
    const text = formatVisualAnalysis(partial);
    expect(text).toContain('primary focus = "unknown"');
    expect(text).toContain('Contrast Issues (0):');
    expect(text).toContain('No assessment available');
  });

  it('does not throw when arrays are the wrong type entirely', () => {
    const partial = {
      visualHierarchy: 'not-an-object',
      contrastIssues: 'not-an-array',
      spacingIssues: null,
      affordanceIssues: undefined,
      stateIndicators: { not: 'array' },
      overallAssessment: 42,
    } as unknown as VisualUnderstanding;
    expect(() => formatVisualAnalysis(partial)).not.toThrow();
  });
});
