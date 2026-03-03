import { describe, it, expect } from 'vitest';
import { classifyTransition } from '../../../../src/pipelines/temporal/classifier.js';
import type { SceneGraph, SceneGraphDiff, SceneNode } from '../../../../src/types/index.js';

const emptyDiff: SceneGraphDiff = { added: [], removed: [], modified: [], stable: [] };

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

describe('classifyTransition', () => {
  it('URL changed → navigation', () => {
    const prev = makeGraph([makeNode('n1')], 'https://example.com/a');
    const next = makeGraph([makeNode('n1')], 'https://example.com/b');
    expect(classifyTransition(emptyDiff, prev, next)).toBe('navigation');
  });

  it('viewportPosition above→visible with no adds/removes → scroll_reveal', () => {
    const diff: SceneGraphDiff = {
      ...emptyDiff,
      modified: [{ nodeId: 'n1', changes: [{ field: 'viewportPosition', from: 'above', to: 'visible' }] }],
    };
    const graph = makeGraph([makeNode('n1')]);
    expect(classifyTransition(diff, graph, graph)).toBe('scroll_reveal');
  });

  it('nodes added all under same parent → expand_collapse', () => {
    const diff: SceneGraphDiff = {
      ...emptyDiff,
      added: [makeNode('c1', { parent: 'p1' }), makeNode('c2', { parent: 'p1' })],
    };
    const graph = makeGraph([]);
    expect(classifyTransition(diff, graph, graph)).toBe('expand_collapse');
  });

  it('new root node with children → modal_open', () => {
    const modal = makeNode('modal', { children: ['modal-body'] });
    const diff: SceneGraphDiff = { ...emptyDiff, added: [modal] };
    const graph = makeGraph([]);
    expect(classifyTransition(diff, graph, graph)).toBe('modal_open');
  });

  it('visualState → error → form_feedback', () => {
    const diff: SceneGraphDiff = {
      ...emptyDiff,
      modified: [{ nodeId: 'input1', changes: [{ field: 'visualState', from: 'normal', to: 'error' }] }],
    };
    const graph = makeGraph([makeNode('input1')]);
    expect(classifyTransition(diff, graph, graph)).toBe('form_feedback');
  });

  it('nodes added under different parents → list_updated', () => {
    const diff: SceneGraphDiff = {
      ...emptyDiff,
      added: [makeNode('item1', { parent: 'list-a' }), makeNode('item2', { parent: 'list-b' })],
    };
    const graph = makeGraph([]);
    expect(classifyTransition(diff, graph, graph)).toBe('list_updated');
  });

  it('no changes → content_loaded (default)', () => {
    const graph = makeGraph([makeNode('n1')]);
    expect(classifyTransition(emptyDiff, graph, graph)).toBe('content_loaded');
  });
});
