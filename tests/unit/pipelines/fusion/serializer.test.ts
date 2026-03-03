import { describe, it, expect } from 'vitest';
import { toJSON, toCompact } from '../../../../src/pipelines/fusion/serializer.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/index.js';

const makeNode = (id: string, label: string, role: string, parent?: string, children: string[] = []): SceneNode => ({
  id, tag: 'div', role, label, boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0,
  interactionType: 'clickable', isDisabled: false, isLoading: false, isFocused: false,
  visualState: 'normal', parent, children, spatialRelationships: [],
  visualConfidence: 0.9, structuralConfidence: 1, fusionMethod: 'fused',
  text: label === 'button' ? 'Click me' : undefined,
});

const graph: SceneGraph = {
  timestamp: 1000, url: 'https://example.com',
  viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 },
  nodes: [
    makeNode('root', 'nav', 'navigation', undefined, ['child1']),
    makeNode('child1', 'button', 'button', 'root'),
  ],
  rootNodeIds: ['root'],
};

describe('serializer', () => {
  it('toJSON returns valid JSON string containing all nodes', () => {
    const json = toJSON(graph);
    const parsed = JSON.parse(json) as SceneGraph;
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.url).toBe('https://example.com');
  });

  it('toCompact renders root node on first line', () => {
    const compact = toCompact(graph);
    const lines = compact.split('\n');
    expect(lines[0]).toContain('nav');
    expect(lines[0]).toContain('navigation');
  });

  it('toCompact indents child nodes', () => {
    const compact = toCompact(graph);
    const lines = compact.split('\n');
    expect(lines[1]).toMatch(/^\s+/); // starts with whitespace
    expect(lines[1]).toContain('button');
  });

  it('toCompact includes text content', () => {
    const compact = toCompact(graph);
    expect(compact).toContain('Click me');
  });

  it('toCompact marks disabled elements', () => {
    const graphWithDisabled: SceneGraph = {
      ...graph,
      nodes: [{ ...makeNode('n1', 'button', 'button'), isDisabled: true }],
      rootNodeIds: ['n1'],
    };
    expect(toCompact(graphWithDisabled)).toContain('disabled');
  });
});
