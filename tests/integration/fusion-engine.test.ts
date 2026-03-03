import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { StructuralPipeline } from '../../src/pipelines/structural/index.js';
import { FusionEngine } from '../../src/pipelines/fusion/index.js';
import { toJSON, toCompact } from '../../src/pipelines/fusion/serializer.js';
import type { VisualElement } from '../../src/types/index.js';

describe('FusionEngine integration', () => {
  let runtime: BrowserRuntime;
  let structural: StructuralPipeline;
  let engine: FusionEngine;

  beforeAll(async () => {
    runtime = new BrowserRuntime();
    await runtime.launch();
    await runtime.navigate('https://example.com');
    structural = new StructuralPipeline();
    engine = new FusionEngine();
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('fuses structural nodes with zero visual elements → all structural_only', async () => {
    const structuralNodes = await structural.extractStructure(runtime.getPage());
    const graph = engine.fuse([], structuralNodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every(n => n.fusionMethod === 'structural_only')).toBe(true);
    expect(graph.rootNodeIds.length).toBeGreaterThan(0);
    console.log(`✓ Structural-only graph: ${graph.nodes.length} nodes, ${graph.rootNodeIds.length} roots`);
  });

  it('fuses mock visual elements with structural nodes → some fused pairs', async () => {
    const structuralNodes = await structural.extractStructure(runtime.getPage());
    const firstVisible = structuralNodes.find(n => n.states.isVisible && n.boundingBox.width > 0);
    const mockVisual: VisualElement[] = firstVisible ? [{
      id: 'mock-v1',
      label: firstVisible.tag,
      confidence: 0.9,
      boundingBox: firstVisible.boundingBox,
      visualProperties: {},
    }] : [];

    const graph = engine.fuse(mockVisual, structuralNodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });

    if (mockVisual.length > 0) {
      expect(graph.nodes.filter(n => n.fusionMethod === 'fused').length).toBeGreaterThan(0);
    }

    const json = toJSON(graph);
    expect(() => JSON.parse(json)).not.toThrow();
    const compact = toCompact(graph);
    expect(compact.length).toBeGreaterThan(0);
    console.log(`✓ Mixed graph: ${graph.nodes.filter(n => n.fusionMethod === 'fused').length} fused, ${graph.nodes.filter(n => n.fusionMethod === 'structural_only').length} structural-only`);
    console.log('Compact preview (first 3 lines):');
    console.log(compact.split('\n').slice(0, 3).join('\n'));
  });
});
