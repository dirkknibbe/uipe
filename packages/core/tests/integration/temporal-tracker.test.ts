// tests/integration/temporal-tracker.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { StructuralPipeline } from '../../src/pipelines/structural/index.js';
import { FusionEngine } from '../../src/pipelines/fusion/index.js';
import { TemporalTracker } from '../../src/pipelines/temporal/index.js';

describe('TemporalTracker integration', () => {
  let runtime: BrowserRuntime;
  let structural: StructuralPipeline;
  let engine: FusionEngine;
  let tracker: TemporalTracker;

  beforeAll(async () => {
    runtime = new BrowserRuntime();
    await runtime.launch();
    structural = new StructuralPipeline();
    engine = new FusionEngine();
    tracker = new TemporalTracker();
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('first observation returns null and stores graph', async () => {
    await runtime.navigate('https://example.com');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = engine.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });
    const result = tracker.observe(graph);
    expect(result).toBeNull();
    expect(tracker.getLatest()).toBe(graph);
    console.log(`✓ First observation: ${graph.nodes.length} nodes stored`);
  });

  it('same page re-observed → transition with mostly stable nodes', async () => {
    expect(tracker.getLatest()).not.toBeNull();
    await runtime.navigate('https://example.com');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = engine.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });
    const transition = tracker.observe(graph);
    expect(transition).not.toBeNull();
    expect(transition!.diff).toBeDefined();
    expect(transition!.timestamp).toBe(graph.timestamp);
    console.log(`✓ Same-page transition: type=${transition!.type}, stable=${transition!.diff.stable.length}, modified=${transition!.diff.modified.length}`);
  });

  it('navigation to different URL → navigation transition', async () => {
    expect(tracker.getLatest()).not.toBeNull();
    // Use a data URI to avoid network dependency
    await runtime.navigate('data:text/html,<html><body><h1>Page 2</h1></body></html>');
    const nodes = await structural.extractStructure(runtime.getPage());
    const graph = engine.fuse([], nodes, {
      url: runtime.currentUrl(),
      viewport: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
    });
    const transition = tracker.observe(graph);
    expect(transition).not.toBeNull();
    expect(transition!.type).toBe('navigation');
    expect(tracker.getHistory().length).toBeGreaterThan(0);
    console.log(`✓ Navigation detected: ${transition!.diff.removed.length} removed, ${transition!.diff.added.length} added`);
  });
});
