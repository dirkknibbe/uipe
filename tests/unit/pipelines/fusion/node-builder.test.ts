// tests/unit/pipelines/fusion/node-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildSceneNode } from '../../../../src/pipelines/fusion/node-builder.js';
import type { MatchPair } from '../../../../src/pipelines/fusion/matcher.js';
import type { VisualElement, StructuralNode, Viewport } from '../../../../src/types/index.js';

const viewport: Viewport = { width: 1280, height: 720 };

const makeVisual = (id: string, x: number, y: number, w: number, h: number): VisualElement => ({
  id, label: 'button', confidence: 0.9, boundingBox: { x, y, width: w, height: h }, visualProperties: {},
});
const makeStructural = (id: string, x: number, y: number, w: number, h: number, extra: Partial<StructuralNode> = {}): StructuralNode => ({
  id, tag: 'button', boundingBox: { x, y, width: w, height: h },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 2, overflow: 'visible', pointerEvents: 'auto', cursor: 'pointer' },
  attributes: { placeholder: 'Enter text' },
  states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
  children: [], parent: undefined, ...extra,
});

describe('buildSceneNode', () => {
  it('fused pair → SceneNode uses structural id, visual label, fused method', () => {
    const pair: MatchPair = {
      visualElement: makeVisual('v1', 10, 10, 100, 40),
      structuralNode: makeStructural('s1', 10, 10, 100, 40),
      iou: 0.95, fusionMethod: 'fused',
    };
    const node = buildSceneNode(pair, viewport);
    expect(node.id).toBe('s1');
    expect(node.label).toBe('button');
    expect(node.fusionMethod).toBe('fused');
    expect(node.visualConfidence).toBe(0.9);
    expect(node.structuralConfidence).toBe(1);
    expect(node.zLayer).toBe(2); // from computedStyle.zIndex
    expect(node.placeholder).toBe('Enter text');
  });

  it('visual_only pair → SceneNode uses visual id, zero structuralConfidence', () => {
    const pair: MatchPair = {
      visualElement: makeVisual('v1', 10, 10, 100, 40),
      structuralNode: null,
      iou: 0, fusionMethod: 'visual_only',
    };
    const node = buildSceneNode(pair, viewport);
    expect(node.id).toBe('v1');
    expect(node.fusionMethod).toBe('visual_only');
    expect(node.structuralConfidence).toBe(0);
    expect(node.visualConfidence).toBe(0.9);
  });

  it('structural_only pair → SceneNode uses structural id, zero visualConfidence', () => {
    const pair: MatchPair = {
      visualElement: null,
      structuralNode: makeStructural('s1', 10, 10, 100, 40),
      iou: 0, fusionMethod: 'structural_only',
    };
    const node = buildSceneNode(pair, viewport);
    expect(node.id).toBe('s1');
    expect(node.fusionMethod).toBe('structural_only');
    expect(node.visualConfidence).toBe(0);
    expect(node.structuralConfidence).toBe(1);
  });

  it('viewportPosition: visible when fully inside viewport', () => {
    const pair: MatchPair = {
      visualElement: null,
      structuralNode: makeStructural('s1', 100, 100, 200, 100),
      iou: 0, fusionMethod: 'structural_only',
    };
    expect(buildSceneNode(pair, viewport).viewportPosition).toBe('visible');
  });

  it('viewportPosition: below when element is below viewport', () => {
    const pair: MatchPair = {
      visualElement: null,
      structuralNode: makeStructural('s1', 0, 800, 100, 50), // y=800 > viewport.height=720
      iou: 0, fusionMethod: 'structural_only',
    };
    expect(buildSceneNode(pair, viewport).viewportPosition).toBe('below');
  });

  it('visibilityPercent: 100 when fully visible, 0 when fully outside', () => {
    const fullyVisible: MatchPair = { visualElement: null,
      structuralNode: makeStructural('s1', 100, 100, 200, 100), iou: 0, fusionMethod: 'structural_only' };
    expect(buildSceneNode(fullyVisible, viewport).visibilityPercent).toBe(100);

    const fullyOutside: MatchPair = { visualElement: null,
      structuralNode: makeStructural('s2', 2000, 2000, 100, 50), iou: 0, fusionMethod: 'structural_only' };
    expect(buildSceneNode(fullyOutside, viewport).visibilityPercent).toBe(0);
  });

  it('interactionType: typeable for editable structural node', () => {
    const pair: MatchPair = {
      visualElement: null,
      structuralNode: makeStructural('s1', 0, 0, 100, 30, {
        tag: 'input',
        states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: true },
      }),
      iou: 0, fusionMethod: 'structural_only',
    };
    expect(buildSceneNode(pair, viewport).interactionType).toBe('typeable');
  });

  it('interactionType: static for disabled element', () => {
    const pair: MatchPair = {
      visualElement: null,
      structuralNode: makeStructural('s1', 0, 0, 100, 30, {
        states: { isVisible: true, isInteractable: false, isDisabled: true, isFocused: false, isEditable: false },
      }),
      iou: 0, fusionMethod: 'structural_only',
    };
    expect(buildSceneNode(pair, viewport).interactionType).toBe('static');
  });
});
