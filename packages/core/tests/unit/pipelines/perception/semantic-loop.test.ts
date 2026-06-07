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

  it('does not record a ghost tick when tick body throws (P2-H2 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const structural = {
      extractStructure: vi.fn(async () => { throw new Error('extract-boom'); }),
    } as unknown as StructuralPipeline;
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();

      // Tick body threw — tickCounts.semantic must NOT have been bumped.
      // Previously recordTick ran BEFORE the try, so a failed tick still
      // showed up in the summary as a successful tick.
      expect(session.getSummary().tickCounts.semantic).toBe(0);
    } finally {
      logSpy.mockRestore();
      loop.stop();
    }
  });

  it('prevents concurrent first-tick when a second escalate arrives mid-await (P2-H1 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    // Hold the first extractStructure call open so we can race a second escalate.
    let resolveFirst: (v: any[]) => void = () => {};
    let callCount = 0;
    const extractStructure = vi.fn((): Promise<any[]> => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<any[]>((r) => { resolveFirst = r; });
      }
      return Promise.resolve([]);
    });
    const structural = { extractStructure } as unknown as StructuralPipeline;
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();

    // First escalate — fires scheduleWake → tick → awaits extractStructure.
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(extractStructure).toHaveBeenCalledTimes(1);

    // Second escalate ARRIVES mid-await. Previously: lastTickMs === 0 carve-out
    // let this run a second tick concurrently with the first. After the fix,
    // an inFlight guard suppresses the concurrent re-entry.
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(extractStructure).toHaveBeenCalledTimes(1);

    // Resolve the first tick so the test cleans up.
    resolveFirst([]);
    await Promise.resolve();
    await Promise.resolve();
    loop.stop();
  });

  it('stop() calls clearTimeout on the pending wakeTimer (G6)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer: mkIndexer(new Map()),
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    // Schedule a wake.
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    expect((loop as any).wakeTimer).not.toBeNull();

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const handle = (loop as any).wakeTimer;
    loop.stop();

    expect(clearSpy).toHaveBeenCalledWith(handle);
    expect((loop as any).wakeTimer).toBeNull();
    clearSpy.mockRestore();
  });

  it('coalesces rapid scheduleWake calls into a single setTimeout (P2-I2 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const structural = mkStructural([]);
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();

    // Spy on setTimeout BEFORE firing escalates so we count just the loop's
    // schedules, not vitest's internal ones.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // Two escalates in the same JS turn — previously each call overwrote
    // this.wakeTimer without clearing the prior handle (leaked timer ref).
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });

    // Only one timer should be scheduled for the same pending escalation.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    setTimeoutSpy.mockRestore();
    await vi.advanceTimersByTimeAsync(10);
    loop.stop();
  });

  it('catches tick errors and does not advance lastTickMs so the next escalation retries (I3 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    // Structural pipeline rejects — previously this became an unhandled
    // rejection from `void this.tick()` and `lastTickMs` was already advanced,
    // gating out the next escalation silently.
    const structural = {
      extractStructure: vi.fn(async () => { throw new Error('extract-boom'); }),
    } as unknown as StructuralPipeline;
    const indexer = mkIndexer(new Map());
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer,
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      loop.start();
      session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
      // Drain the setTimeout + the awaited rejection.
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();

      expect(unhandled).toEqual([]);
      // Warn was logged.
      const warned = logSpy.mock.calls.some((c) => {
        const [prefix, msg] = c;
        return (
          typeof prefix === 'string' &&
          prefix.includes('[WARN]') &&
          typeof msg === 'string' &&
          /tick failed/i.test(msg)
        );
      });
      expect(warned).toBe(true);

      // lastTickMs must NOT have advanced — so a follow-up escalation
      // arriving inside the cadence window still ticks.
      expect((loop as any).lastTickMs).toBe(0);

      // Send a second escalation; the gate should still let it through.
      structural.extractStructure = vi.fn(async () => []) as any;
      session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();

      const ticks = stream.push.mock.calls
        .map((c) => c[0])
        .filter((e) => e.type === 'perception-tick' && (e.payload as any).tier === 'semantic');
      // Failed tick records nothing (P2-H2 fix removed ghost ticks); only
      // the successful retry records one. What we're proving here is that
      // the cadence gate didn't silently skip the retry.
      expect(ticks.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      logSpy.mockRestore();
      loop.stop();
    }
  });

  it('does not tick when idle (no escalations, heartbeat fires but queue empty)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
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
    await session.start(0);
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
    await session.start(0);
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
    await session.start(0);
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
    await session.start(0);
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
    await session.start(0);
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
    await session.start(0);
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

  it('resets inFlight after a failed tick so the next escalation can re-enter tick() (test gap C)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    // extractStructure throws on EVERY call. The finally{ inFlight = false } is
    // load-bearing: if a refactor moved the reset into the success branch,
    // inFlight would stay true after the first bad tick and the loop would
    // deadlock — extractStructure would be called only once. Proving it's
    // called twice proves the reset survived.
    const extractStructure = vi.fn(async () => { throw new Error('extract-boom'); });
    const structural = { extractStructure } as unknown as StructuralPipeline;
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer: mkIndexer(new Map()),
      structuralPipeline: structural,
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();
      expect(extractStructure).toHaveBeenCalledTimes(1);

      // Second escalation after the failed tick must re-enter (inFlight reset).
      session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();
      expect(extractStructure).toHaveBeenCalledTimes(2);
    } finally {
      logSpy.mockRestore();
      loop.stop();
    }
  });

  it('stop() is a no-op for the wake timer when none is scheduled (G6 null-path)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const loop = new SemanticLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      indexer: mkIndexer(new Map()),
      structuralPipeline: mkStructural([]),
      page: mkPage(),
      config: { cadenceMs: 200 },
    });
    loop.start();
    // No escalation fired → no wake scheduled.
    expect((loop as any).wakeTimer).toBeNull();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    expect(() => loop.stop()).not.toThrow();
    expect(clearSpy).not.toHaveBeenCalled();
    expect((loop as any).wakeTimer).toBeNull();
    clearSpy.mockRestore();
  });

  it('stop() unsubscribes — escalations after stop are ignored', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
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
