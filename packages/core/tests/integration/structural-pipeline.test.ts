import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { StructuralPipeline } from '../../src/pipelines/structural/index.js';

describe('StructuralPipeline integration', () => {
  let runtime: BrowserRuntime;
  let pipeline: StructuralPipeline;

  beforeAll(async () => {
    runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();
    pipeline = new StructuralPipeline();
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('extracts structural nodes from example.com', async () => {
    await runtime.navigate('https://example.com');
    const page = runtime.getPage();
    const nodes = await pipeline.extractStructure(page);

    expect(nodes.length).toBeGreaterThan(5);
    expect(nodes.filter(n => n.states.isVisible).length).toBeGreaterThan(0);
    expect(nodes.filter(n => n.states.isInteractable).length).toBeGreaterThan(0);

    const interactable = pipeline.filterInteractable(nodes);
    console.log('✓ Total nodes:', nodes.length);
    console.log('✓ Visible:', nodes.filter(n => n.states.isVisible).length);
    console.log('✓ Interactable:', interactable.length);
  }, 30000);

  it('buildIndex allows O(1) node lookup', async () => {
    await runtime.navigate('https://example.com');
    const nodes = await pipeline.extractStructure(runtime.getPage());
    const index = pipeline.buildIndex(nodes);
    expect(index.size).toBe(nodes.length);
    const first = nodes[0];
    expect(index.get(first.id)).toBe(first);
  }, 30000);
});
