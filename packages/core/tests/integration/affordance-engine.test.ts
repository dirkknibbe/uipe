// tests/integration/affordance-engine.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { StructuralPipeline } from '../../src/pipelines/structural/index.js';
import { FusionEngine } from '../../src/pipelines/fusion/index.js';
import { AffordanceEngine } from '../../src/pipelines/affordance/index.js';

describe('AffordanceEngine integration', () => {
  let runtime: BrowserRuntime;
  let structural: StructuralPipeline;
  let fusion: FusionEngine;
  let affordance: AffordanceEngine;

  beforeAll(async () => {
    runtime = new BrowserRuntime();
    await runtime.launch();
    structural = new StructuralPipeline();
    fusion = new FusionEngine();
    affordance = new AffordanceEngine();
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('analyzes example.com — produces affordance map with entries', async () => {
    await runtime.navigate('https://example.com');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = fusion.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });

    const map = affordance.analyze(graph);

    expect(map.size).toBeGreaterThan(0);
    console.log(`✓ AffordanceMap: ${map.size} interactive nodes from ${graph.nodes.length} total`);
  });

  it('all affordance entries are for interactive non-disabled nodes', async () => {
    await runtime.navigate('https://example.com');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = fusion.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });

    const map = affordance.analyze(graph);
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    for (const [id, aff] of map) {
      const node = nodeMap.get(id)!;
      expect(node.interactionType).not.toBe('static');
      expect(node.isDisabled).toBe(false);
      expect(aff.predictions.length).toBeGreaterThan(0);
    }
    console.log(`✓ All ${map.size} entries are valid interactive nodes`);
  });

  it('example.com links have navigation predictions with high priority', async () => {
    await runtime.navigate('https://example.com');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = fusion.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });

    const map = affordance.analyze(graph);
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

    const linkAffordances = [...map.entries()]
      .filter(([id]) => {
        const node = nodeMap.get(id)!;
        return node.tag === 'a' || node.role === 'link';
      });

    expect(linkAffordances.length).toBeGreaterThan(0);
    for (const [, aff] of linkAffordances) {
      expect(aff.predictions[0].predictedOutcome).toMatch(/navigat/i);
      expect(aff.priority).toBe('high');
    }
    console.log(`✓ ${linkAffordances.length} link affordances with navigation predictions`);
  });
});
