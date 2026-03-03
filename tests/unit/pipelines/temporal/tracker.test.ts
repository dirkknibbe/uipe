import { describe, it, expect } from 'vitest';
import { TemporalTracker } from '../../../../src/pipelines/temporal/index.js';
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

const makeGraph = (nodes: SceneNode[], url = 'https://example.com', ts = 1000): SceneGraph => ({
  timestamp: ts, url,
  viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 },
  nodes, rootNodeIds: nodes.filter(n => !n.parent).map(n => n.id),
});

describe('TemporalTracker', () => {
  it('first observe → returns null, stores graph as latest', () => {
    const tracker = new TemporalTracker();
    const graph = makeGraph([makeNode('n1')]);
    expect(tracker.observe(graph)).toBeNull();
    expect(tracker.getLatest()).toBe(graph);
    const graph2 = makeGraph([makeNode('n1'), makeNode('n2')]);
    tracker.observe(graph2);
    expect(tracker.getLatest()).toBe(graph2);
  });

  it('second observe → returns StateTransition with diff', () => {
    const tracker = new TemporalTracker();
    tracker.observe(makeGraph([makeNode('n1')]));
    const transition = tracker.observe(makeGraph([makeNode('n1'), makeNode('n2')]));
    expect(transition).not.toBeNull();
    expect(transition!.diff.added).toHaveLength(1);
    expect(transition!.diff.added[0].id).toBe('n2');
    expect(transition!.type).toBe('content_loaded');
  });

  it('transition timestamp equals next graph timestamp', () => {
    const tracker = new TemporalTracker();
    tracker.observe(makeGraph([makeNode('n1')], 'https://example.com', 1000));
    const transition = tracker.observe(makeGraph([makeNode('n1'), makeNode('n2')], 'https://example.com', 2000));
    expect(transition!.timestamp).toBe(2000);
  });

  it('getHistory accumulates all transitions in order', () => {
    const tracker = new TemporalTracker();
    tracker.observe(makeGraph([makeNode('n1')]));
    tracker.observe(makeGraph([makeNode('n1'), makeNode('n2')]));
    tracker.observe(makeGraph([makeNode('n1'), makeNode('n2'), makeNode('n3')]));
    expect(tracker.getHistory()).toHaveLength(2);
  });

  it('reset clears history and latest', () => {
    const tracker = new TemporalTracker();
    tracker.observe(makeGraph([makeNode('n1')]));
    tracker.observe(makeGraph([makeNode('n1'), makeNode('n2')]));
    tracker.reset();
    expect(tracker.getLatest()).toBeNull();
    expect(tracker.getHistory()).toHaveLength(0);
  });

  it('URL change between observations → transition type is navigation', () => {
    const tracker = new TemporalTracker();
    tracker.observe(makeGraph([makeNode('n1')], 'https://example.com/a'));
    const transition = tracker.observe(makeGraph([makeNode('n1')], 'https://example.com/b'));
    expect(transition!.type).toBe('navigation');
  });
});
