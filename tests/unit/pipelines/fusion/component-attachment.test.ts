import { describe, it, expect } from 'vitest';
import { FusionEngine } from '../../../../src/pipelines/fusion/index.js';
import type { StructuralNode, VisualElement } from '../../../../src/types/index.js';
import type { ComponentField } from '../../../../src/pipelines/component-index/types.js';

function mkStructural(id: string, tag: string): StructuralNode {
  return {
    id, tag, role: undefined, name: undefined, text: undefined,
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: {},
    states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
    children: [], parent: undefined,
  };
}

const context = {
  url: 'https://x',
  viewport: { width: 1280, height: 720 },
  scrollPosition: { x: 0, y: 0 },
};

describe('FusionEngine.fuse with componentMap', () => {
  it('attaches component field when map has an entry for the structural id', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const visual: VisualElement[] = [];
    const map = new Map<string, ComponentField>([
      ['dom-1', { name: 'Button', source: 'rules', signature: '0123456789abcdef' }],
    ]);
    const graph = fusion.fuse(visual, structural, context, map);
    expect(graph.nodes[0].component).toEqual({ name: 'Button', source: 'rules', signature: '0123456789abcdef' });
  });

  it('attaches pending variant', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'div')];
    const map = new Map<string, ComponentField>([
      ['dom-1', { name: null, status: 'pending', signature: 'aaaaaaaaaaaaaaaa' }],
    ]);
    const graph = fusion.fuse([], structural, context, map);
    expect(graph.nodes[0].component).toEqual({ name: null, status: 'pending', signature: 'aaaaaaaaaaaaaaaa' });
  });

  it('omits component field when map has no entry for the id', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const graph = fusion.fuse([], structural, context, new Map());
    expect(graph.nodes[0].component).toBeUndefined();
  });

  it('works when componentMap is omitted entirely (backwards-compatible)', () => {
    const fusion = new FusionEngine();
    const structural = [mkStructural('dom-1', 'button')];
    const graph = fusion.fuse([], structural, context);
    expect(graph.nodes[0].component).toBeUndefined();
  });
});
