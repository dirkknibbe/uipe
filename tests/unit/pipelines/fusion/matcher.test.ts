import { describe, it, expect } from 'vitest';
import { matchElements } from '../../../../src/pipelines/fusion/matcher.js';
import type { VisualElement, StructuralNode } from '../../../../src/types/index.js';

const makeVisual = (id: string, x: number, y: number, w: number, h: number, label = 'button'): VisualElement => ({
  id, label, confidence: 0.9, boundingBox: { x, y, width: w, height: h }, visualProperties: {},
});
const makeStructural = (id: string, x: number, y: number, w: number, h: number): StructuralNode => ({
  id, tag: 'button', boundingBox: { x, y, width: w, height: h },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'pointer' },
  attributes: {}, states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
  children: [],
});

describe('matchElements', () => {
  it('matches visual and structural with perfect overlap → fused', () => {
    const visual = [makeVisual('v1', 10, 10, 100, 40)];
    const structural = [makeStructural('s1', 10, 10, 100, 40)];
    const pairs = matchElements(visual, structural);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ iou: 1, fusionMethod: 'fused' });
    expect(pairs[0].visualElement?.id).toBe('v1');
    expect(pairs[0].structuralNode?.id).toBe('s1');
  });

  it('assigns visual_only when IoU < 0.3', () => {
    const visual = [makeVisual('v1', 0, 0, 50, 50)];
    const structural = [makeStructural('s1', 500, 500, 50, 50)]; // far away
    const pairs = matchElements(visual, structural);
    const visualOnlyPairs = pairs.filter(p => p.fusionMethod === 'visual_only');
    const structuralOnlyPairs = pairs.filter(p => p.fusionMethod === 'structural_only');
    expect(visualOnlyPairs).toHaveLength(1);
    expect(structuralOnlyPairs).toHaveLength(1);
  });

  it('assigns structural_only for structural nodes not matched to any visual', () => {
    const visual: VisualElement[] = [];
    const structural = [makeStructural('s1', 10, 10, 100, 40)];
    const pairs = matchElements(visual, structural);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fusionMethod).toBe('structural_only');
    expect(pairs[0].structuralNode?.id).toBe('s1');
  });

  it('each structural node matched to at most one visual element', () => {
    // Two visual elements overlapping the same structural node — only best IoU wins
    const visual = [makeVisual('v1', 10, 10, 100, 40), makeVisual('v2', 12, 12, 96, 36)];
    const structural = [makeStructural('s1', 10, 10, 100, 40)];
    const pairs = matchElements(visual, structural);
    const fusedPairs = pairs.filter(p => p.fusionMethod === 'fused');
    expect(fusedPairs).toHaveLength(1); // only one visual gets the structural node
  });

  it('skips invisible structural nodes when matching', () => {
    const visual = [makeVisual('v1', 10, 10, 100, 40)];
    const invisibleStructural: StructuralNode = {
      ...makeStructural('s1', 10, 10, 100, 40),
      states: { isVisible: false, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    };
    const pairs = matchElements(visual, [invisibleStructural]);
    expect(pairs.find(p => p.fusionMethod === 'visual_only')).toBeDefined();
  });
});
