import { describe, it, expect } from 'vitest';
import { StructuralPipeline } from '../../../../src/pipelines/structural/index.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function makeNode(overrides: Partial<StructuralNode> = {}): StructuralNode {
  return {
    id: 'n1', tag: 'div',
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'default' },
    attributes: {},
    states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    children: [],
    ...overrides,
  };
}

describe('StructuralPipeline helpers', () => {
  const pipeline = new StructuralPipeline();

  it('filterInteractable returns only visible+interactable nodes', () => {
    const nodes = [
      makeNode({ id: 'a', states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false } }),
      makeNode({ id: 'b', states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false } }),
      makeNode({ id: 'c', states: { isVisible: false, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false } }),
    ];
    const result = pipeline.filterInteractable(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('findByRole matches both tag and role attribute', () => {
    const nodes = [
      makeNode({ id: 'a', tag: 'button' }),
      makeNode({ id: 'b', tag: 'div', role: 'button' }),
      makeNode({ id: 'c', tag: 'div' }),
    ];
    expect(pipeline.findByRole(nodes, 'button').map(n => n.id)).toEqual(['a', 'b']);
  });

  it('buildIndex creates id→node map', () => {
    const nodes = [makeNode({ id: 'x' }), makeNode({ id: 'y' })];
    const index = pipeline.buildIndex(nodes);
    expect(index.size).toBe(2);
    expect(index.get('x')?.id).toBe('x');
  });
});
