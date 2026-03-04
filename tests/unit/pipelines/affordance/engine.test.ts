import { describe, it, expect } from 'vitest';
import { AffordanceEngine } from '../../../../src/pipelines/affordance/index.js';
import type { SceneGraph, SceneNode, StateTransition, SceneGraphDiff } from '../../../../src/types/index.js';

const makeNode = (id: string, overrides: Partial<SceneNode> = {}): SceneNode => ({
  id, tag: 'button', role: 'button', label: 'Click',
  boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0,
  interactionType: 'clickable', isDisabled: false, isLoading: false, isFocused: false,
  visualState: 'normal', children: [], spatialRelationships: [],
  visualConfidence: 0, structuralConfidence: 1, fusionMethod: 'structural_only',
  ...overrides,
});

const makeGraph = (nodes: SceneNode[]): SceneGraph => ({
  timestamp: Date.now(), url: 'https://example.com',
  viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 },
  nodes, rootNodeIds: nodes.filter(n => !n.parent).map(n => n.id),
});

const emptyDiff: SceneGraphDiff = { added: [], removed: [], modified: [], stable: [] };

describe('AffordanceEngine', () => {
  const engine = new AffordanceEngine();

  it('static node not included in affordance map', () => {
    const graph = makeGraph([makeNode('n1', { interactionType: 'static' })]);
    const map = engine.analyze(graph);
    expect(map.has('n1')).toBe(false);
  });

  it('disabled node not included in affordance map', () => {
    const graph = makeGraph([makeNode('n1', { isDisabled: true })]);
    const map = engine.analyze(graph);
    expect(map.has('n1')).toBe(false);
  });

  it('interactive node included with predictions and priority', () => {
    const graph = makeGraph([makeNode('btn1', { role: 'button', interactionType: 'clickable' })]);
    const map = engine.analyze(graph);
    const affordance = map.get('btn1');
    expect(affordance).toBeDefined();
    expect(affordance!.predictions).toHaveLength(1);
    expect(['high', 'medium', 'low']).toContain(affordance!.priority);
  });

  it('map contains only non-static non-disabled nodes', () => {
    const graph = makeGraph([
      makeNode('link1', { role: 'link', tag: 'a' }),
      makeNode('static1', { interactionType: 'static' }),
      makeNode('disabled1', { isDisabled: true }),
      makeNode('input1', { interactionType: 'typeable', role: 'textbox' }),
    ]);
    const map = engine.analyze(graph);
    expect(map.size).toBe(2);
    expect(map.has('link1')).toBe(true);
    expect(map.has('input1')).toBe(true);
  });

  it('history passed to predictor — button with form_feedback history gets higher confidence', () => {
    const history: StateTransition[] = [{
      type: 'form_feedback',
      timestamp: Date.now(),
      diff: emptyDiff,
    }];
    const graph = makeGraph([makeNode('btn1', { role: 'button' })]);

    const mapNoHistory = engine.analyze(graph, []);
    const mapWithHistory = engine.analyze(graph, history);

    const confNoHistory = mapNoHistory.get('btn1')!.predictions[0].confidence;
    const confWithHistory = mapWithHistory.get('btn1')!.predictions[0].confidence;
    expect(confWithHistory).toBeGreaterThan(confNoHistory);
  });
});
