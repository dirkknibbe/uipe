// tests/unit/pipelines/fusion/engine.test.ts
import { describe, it, expect } from 'vitest';
import { FusionEngine } from '../../../../src/pipelines/fusion/index.js';
import type { VisualElement, StructuralNode } from '../../../../src/types/index.js';

const ctx = { url: 'https://example.com', viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 } };

const makeVisual = (id: string, x: number, y: number): VisualElement => ({
  id, label: 'button', confidence: 0.9, boundingBox: { x, y, width: 100, height: 40 }, visualProperties: {},
});
const makeStructural = (id: string, x: number, y: number, parent?: string): StructuralNode => ({
  id, tag: 'button', boundingBox: { x, y, width: 100, height: 40 },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'pointer' },
  attributes: {}, states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
  children: [], parent,
});

describe('FusionEngine', () => {
  it('fuses visual + structural → SceneGraph with correct metadata', () => {
    const engine = new FusionEngine();
    const graph = engine.fuse(
      [makeVisual('v1', 10, 10)],
      [makeStructural('s1', 10, 10)],
      ctx,
    );
    expect(graph.url).toBe('https://example.com');
    expect(graph.viewport).toEqual({ width: 1280, height: 720 });
    expect(graph.timestamp).toBeGreaterThan(0);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].fusionMethod).toBe('fused');
  });

  it('empty visual + structural → empty nodes, empty rootNodeIds', () => {
    const engine = new FusionEngine();
    const graph = engine.fuse([], [], ctx);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.rootNodeIds).toHaveLength(0);
  });

  it('rootNodeIds contains nodes whose parent is not in the graph', () => {
    const engine = new FusionEngine();
    // s1 has no parent → root. s2's parent is s1 → not root.
    const structural = [
      { ...makeStructural('s1', 0, 0), children: ['s2'] },
      makeStructural('s2', 10, 10, 's1'),
    ];
    const graph = engine.fuse([], structural, ctx);
    expect(graph.rootNodeIds).toContain('s1');
    expect(graph.rootNodeIds).not.toContain('s2');
  });

  it('focusedNodeId set when a structural node is focused', () => {
    const engine = new FusionEngine();
    const structural = [
      { ...makeStructural('s1', 0, 0), states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: true, isEditable: false } },
    ];
    const graph = engine.fuse([], structural, ctx);
    expect(graph.focusedNodeId).toBe('s1');
  });

  it('all-structural input → all structural_only nodes', () => {
    const engine = new FusionEngine();
    const graph = engine.fuse([], [makeStructural('s1', 0, 0), makeStructural('s2', 200, 0)], ctx);
    expect(graph.nodes.every(n => n.fusionMethod === 'structural_only')).toBe(true);
  });
});
