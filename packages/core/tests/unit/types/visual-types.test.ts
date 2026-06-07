import { describe, it, expect } from 'vitest';
import type { VisualElement, AnalysisDepth, VisualAnalysis, VisualUnderstanding } from '../../../src/types/index.js';

describe('Visual types', () => {
  it('VisualElement without isInteractable/description is valid', () => {
    const el: VisualElement = {
      id: 'v-1',
      label: 'button',
      confidence: 0.95,
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      visualProperties: {},
    };
    expect(el.id).toBe('v-1');
    expect(el.isInteractable).toBeUndefined();
    expect(el.description).toBeUndefined();
  });

  it('VisualElement with isInteractable and description is valid', () => {
    const el: VisualElement = {
      id: 'v-2',
      label: 'input',
      confidence: 0.88,
      boundingBox: { x: 10, y: 20, width: 200, height: 30 },
      isInteractable: true,
      description: 'Email input field',
      visualProperties: { hasIcon: true },
    };
    expect(el.isInteractable).toBe(true);
    expect(el.description).toBe('Email input field');
  });

  it('VisualAnalysis with null analysis fields is valid', () => {
    const analysis: VisualAnalysis = {
      elements: [],
      analysis: null,
      deepAnalysis: null,
    };
    expect(analysis.analysis).toBeNull();
    expect(analysis.deepAnalysis).toBeNull();
  });

  it('AnalysisDepth accepts exactly detect, understand, deep', () => {
    const depths: AnalysisDepth[] = ['detect', 'understand', 'deep'];
    expect(depths).toHaveLength(3);
    expect(depths).toContain('detect');
    expect(depths).toContain('understand');
    expect(depths).toContain('deep');
  });

  it('VisualUnderstanding has all required fields', () => {
    const understanding: VisualUnderstanding = {
      visualHierarchy: { primaryFocus: 'hero banner', readingFlow: ['header', 'hero', 'content'] },
      contrastIssues: [{ element: 'nav-link', issue: 'low contrast', estimatedRatio: '2.1:1' }],
      spacingIssues: [],
      affordanceIssues: [{ element: 'div-7', issue: 'looks clickable but is not interactive' }],
      stateIndicators: [{ type: 'loading', element: 'spinner', description: 'spinning loader visible' }],
      overallAssessment: 'Page has good visual hierarchy but some contrast issues.',
    };
    expect(understanding.visualHierarchy.primaryFocus).toBe('hero banner');
    expect(understanding.contrastIssues).toHaveLength(1);
    expect(understanding.overallAssessment).toContain('contrast');
  });
});
