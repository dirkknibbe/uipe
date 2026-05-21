import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SemanticLoop } from '../../../../src/pipelines/perception/semantic-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import type { StructuralPipeline } from '../../../../src/pipelines/structural/index.js';
import type { Indexer } from '../../../../src/pipelines/component-index/indexer.js';
import type { Page } from 'playwright';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeEventStream extends EventEmitter {
  push = vi.fn((_event: TimelineEvent) => {
    // no-op in unit tests; session calls this to record events
  });
}

function mkSession() {
  const stream = new FakeEventStream();
  const session = new PerceptionSession({
    eventStream: stream as unknown as TemporalEventStream,
  });
  return { session, stream };
}

function mkIndexer(componentMap: Map<string, any>): Indexer {
  return {
    run: vi.fn(async () => componentMap),
  } as unknown as Indexer;
}

function mkStructural(nodes: any[]): StructuralPipeline {
  return {
    extractStructure: vi.fn(async () => nodes),
  } as unknown as StructuralPipeline;
}

function mkPage(): Page {
  return {
    url: () => 'http://test',
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SemanticLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not tick when idle (no escalations, heartbeat fires but queue empty)', () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    vi.advanceTimersByTime(500);
    const tickCalls = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick' && (e.payload as any).tier === 'semantic');
    expect(tickCalls).toHaveLength(0);
  });

  it('wakes on escalation and emits a semantic tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });
    await vi.advanceTimersByTimeAsync(10);
    const ticks = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0].payload).toMatchObject({ tier: 'semantic', cause: 'escalation' });
  });

  it('rate-bounds: two escalations within cadenceMs produce one tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });
    await vi.advanceTimersByTimeAsync(50);
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'b', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });
    await vi.advanceTimersByTimeAsync(50);
    const tickCalls = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick' && (e.payload as any).tier === 'semantic');
    expect(tickCalls).toHaveLength(1);
  });

  it('calls structural.extractStructure and indexer.run on each tick', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const indexer = mkIndexer(new Map());
    const structural = mkStructural([{ id: 'n-1', tag: 'div' }]);
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(structural.extractStructure).toHaveBeenCalled();
    expect(indexer.run).toHaveBeenCalled();
  });

  it('uses indexer output (not frame escalation payload) to determine pending regions', async () => {
    // Frame escalation carries nodeId 'x' (a synthetic mut-N id).
    // Structural pipeline returns node 'a'. Indexer returns 'a' as pending.
    // SemanticLoop should escalate using 'a' from the indexer, not 'x' from the frame payload.
    const { session, stream } = mkSession();
    session.start(0);
    const componentMap = new Map([
      ['a', { name: null, status: 'pending', signature: 'sig-1' }],
    ]);
    const indexer = mkIndexer(componentMap);
    const structural = mkStructural([
      { id: 'a', tag: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 50 } },
    ]);

    const intentHandler = vi.fn();
    session.internalEmitter.on('escalate', (payload: any) => {
      if (payload.from === 'semantic') intentHandler(payload);
    });

    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    // Frame escalation uses synthetic id 'x', not 'a'
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'x', bbox: { x: 0, y: 0, w: 100, h: 50 } }],
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(intentHandler).toHaveBeenCalledWith(expect.objectContaining({ from: 'semantic' }));
    // The escalation regions should reference 'a' (from indexer), not 'x' (from frame payload)
    const call = intentHandler.mock.calls[0][0];
    expect(call.regions[0].nodeId).toBe('a');
  });

  it('escalates to intent when indexer flags a node as pending', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const componentMap = new Map([
      ['a', { name: null, status: 'pending', signature: 'sig-1' }],
    ]);
    const indexer = mkIndexer(componentMap);
    const structural = mkStructural([
      { id: 'a', tag: 'div', boundingBox: { x: 0, y: 0, width: 100, height: 50 } },
    ]);

    const intentHandler = vi.fn();
    session.internalEmitter.on('escalate', (payload: any) => {
      if (payload.from === 'semantic') intentHandler(payload);
    });

    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 100, h: 50 } }],
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(intentHandler).toHaveBeenCalledWith(expect.objectContaining({ from: 'semantic' }));
    const escalations = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-escalation');
    expect(escalations.length).toBeGreaterThanOrEqual(1);
    expect(escalations[0].payload).toMatchObject({ from: 'semantic', to: 'intent' });
  });

  it('does not escalate to intent when no nodes are pending', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const componentMap = new Map([
      ['a', { name: 'Button', source: 'rules', signature: 'sig-1' }],
    ]);
    const indexer = mkIndexer(componentMap);
    const structural = mkStructural([
      { id: 'a', tag: 'button', boundingBox: { x: 0, y: 0, width: 100, height: 50 } },
    ]);

    const intentHandler = vi.fn();
    session.internalEmitter.on('escalate', (payload: any) => {
      if (payload.from === 'semantic') intentHandler(payload);
    });

    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 100, h: 50 } }],
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(intentHandler).not.toHaveBeenCalled();
  });

  it('stop() unsubscribes — escalations after stop are ignored', async () => {
    const { session, stream } = mkSession();
    session.start(0);
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer: mkIndexer(new Map()),
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    loop.stop();
    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });
    await vi.advanceTimersByTimeAsync(10);
    const tickCalls = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick' && (e.payload as any).tier === 'semantic');
    expect(tickCalls).toHaveLength(0);
  });
});
