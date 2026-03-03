import { describe, it, expect } from 'vitest';
import { diffGraphs } from '../../../../src/pipelines/temporal/differ.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/index.js';

const makeNode = (id: string, overrides: Partial<SceneNode> = {}): SceneNode => ({
  id, tag: 'div', role: 'region', label: 'section',
  boundingBox: { x: 0, y: 0, width: 100, height: 50 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0,
  interactionType: 'static', isDisabled: false, isLoading: false, isFocused: false,
  visualState: 'normal', children: [], spatialRelationships: [],
  visualConfidence: 0, structuralConfidence: 1, fusionMethod: 'structural_only',
  ...overrides,
});

const makeGraph = (nodes: SceneNode[], url = 'https://example.com'): SceneGraph => ({
  timestamp: Date.now(), url,
  viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 },
  nodes, rootNodeIds: nodes.filter(n => !n.parent).map(n => n.id),
});

describe('diffGraphs', () => {
  it('identical graphs → all nodes stable, nothing added/removed/modified', () => {
    const node = makeNode('n1');
    const graph = makeGraph([node]);
    const diff = diffGraphs(graph, graph);
    expect(diff.stable).toContain('n1');
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it('new node in next → added', () => {
    const prev = makeGraph([makeNode('n1')]);
    const next = makeGraph([makeNode('n1'), makeNode('n2')]);
    const diff = diffGraphs(prev, next);
    expect(diff.added.map(n => n.id)).toContain('n2');
    expect(diff.stable).toContain('n1');
  });

  it('node absent from next → removed', () => {
    const prev = makeGraph([makeNode('n1'), makeNode('n2')]);
    const next = makeGraph([makeNode('n1')]);
    const diff = diffGraphs(prev, next);
    expect(diff.removed.map(n => n.id)).toContain('n2');
    expect(diff.stable).toContain('n1');
  });

  it('changed text field → modified with correct from/to', () => {
    const prev = makeGraph([makeNode('n1', { text: 'hello' })]);
    const next = makeGraph([makeNode('n1', { text: 'world' })]);
    const diff = diffGraphs(prev, next);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].nodeId).toBe('n1');
    expect(diff.modified[0].changes).toContainEqual({ field: 'text', from: 'hello', to: 'world' });
  });

  it('changed isDisabled → modified', () => {
    const prev = makeGraph([makeNode('n1', { isDisabled: false })]);
    const next = makeGraph([makeNode('n1', { isDisabled: true })]);
    const diff = diffGraphs(prev, next);
    expect(diff.modified[0].changes.find(c => c.field === 'isDisabled')).toBeDefined();
  });

  it('empty graphs → empty diff', () => {
    const diff = diffGraphs(makeGraph([]), makeGraph([]));
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.stable).toHaveLength(0);
  });
});
