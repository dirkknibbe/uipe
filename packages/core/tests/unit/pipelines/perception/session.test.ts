import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

function mkStream() {
  return {
    push: vi.fn(),
  } as unknown as TemporalEventStream;
}

describe('PerceptionSession lifecycle', () => {
  let stream: TemporalEventStream;
  let session: PerceptionSession;

  beforeEach(() => {
    stream = mkStream();
    session = new PerceptionSession({ eventStream: stream });
  });

  it('summary starts with zero counts and target cadences', () => {
    const s = session.getSummary();
    expect(s.tickCounts).toEqual({ frame: 0, semantic: 0, intent: 0 });
    expect(s.anomalyCount).toBe(0);
    expect(s.targetCadenceMs.semantic).toBe(200);
    expect(s.targetCadenceMs.intent).toBe(1000);
  });

  it('start() sets startedAt', async () => {
    await session.start(100);
    const s = session.getSummary();
    expect(s.startedAt).toBe(100);
  });

  it('start() called twice throws', async () => {
    await session.start(100);
    await expect(session.start(200)).rejects.toThrow();
  });

  it('stop() sets durationMs based on time elapsed', async () => {
    await session.start(100);
    session.stop(450);
    const s = session.getSummary();
    expect(s.durationMs).toBe(350);
  });

  it('stop() without start throws', () => {
    expect(() => session.stop(100)).toThrow();
  });

  it('onPageClose logs (does not silently swallow) when stop() raises (I1 fix)', async () => {
    await session.start(100);

    // Force stop() to throw to simulate a teardown error mid-close (e.g.,
    // page.off() raising after the page already disconnected).
    const stopSpy = vi.spyOn(session, 'stop').mockImplementation(() => {
      throw new Error('teardown failed');
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const onPageClose = (session as any).onPageClose as () => void;
      // Must not throw — the close handler is fired by Playwright sync.
      expect(() => onPageClose()).not.toThrow();
      const errored = logSpy.mock.calls.some((call) => {
        const [prefix] = call;
        return typeof prefix === 'string' && prefix.includes('[ERROR]');
      });
      expect(errored).toBe(true);
    } finally {
      logSpy.mockRestore();
      stopSpy.mockRestore();
    }
  });

  it('vlmCalls.errorCount is absent when no errors have been recorded (G3)', async () => {
    await session.start(0);
    session.recordIntentResult({ nodeId: 'a', bbox: { x: 0, y: 0, w: 1, h: 1 } }, 'X', 5, 10);
    const s = session.getSummary();
    expect(s.vlmCalls.count).toBe(1);
    // errorCount stays absent (not 0, not present) when there are no errors
    // — keeps the conditional-spread contract stable.
    expect('errorCount' in s.vlmCalls).toBe(false);
  });

  it('recordVlmError bumps the error count and surfaces it in the summary (G4)', async () => {
    await session.start(0);
    session.recordVlmError();
    session.recordVlmError();
    const s = session.getSummary();
    expect(s.vlmCalls.errorCount).toBe(2);
    // No successful calls — count stays 0.
    expect(s.vlmCalls.count).toBe(0);
  });

  it('averageCadenceMs.frame is null when only navigation-reset ticks have fired (G5)', async () => {
    await session.start(0);
    session.recordTick('frame', 'navigation-reset', 100);
    session.recordTick('frame', 'navigation-reset', 5100);
    const s = session.getSummary();
    // Without any real-cadence samples, the average must be null (not 0,
    // not a stale interval from the discontinuity).
    expect(s.averageCadenceMs.frame).toBeNull();
  });

  it('navigation-reset ticks do not skew averageCadenceMs.frame (I4 fix)', async () => {
    await session.start(0);
    // Steady 16 ms cadence
    session.recordTick('frame', 'keyframe', 100);
    session.recordTick('frame', 'keyframe', 116);
    // Page navigation 5 s later — should not be counted as a sample interval.
    session.recordTick('frame', 'navigation-reset', 5116);
    // Resume steady cadence after nav
    session.recordTick('frame', 'keyframe', 5132);
    session.recordTick('frame', 'keyframe', 5148);

    const s = session.getSummary();
    // Without the fix, the ~5000ms gap dominates and average lands well above
    // 1 s. With the fix, average stays near 16 ms (real-cadence samples only).
    expect(s.averageCadenceMs.frame).toBeLessThan(50);
  });

  it('recordTick increments tier count and emits perception-tick', async () => {
    await session.start(100);
    session.recordTick('frame', 'keyframe', 150);
    const s = session.getSummary();
    expect(s.tickCounts.frame).toBe(1);
    expect(stream.push).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'perception-tick', timestamp: 150, payload: { tier: 'frame', cause: 'keyframe' } }),
    );
  });

  it('recordAnomaly increments anomalyCount and reason bucket', async () => {
    await session.start(100);
    session.recordAnomaly('frame', 'mutation-outside-animation', { mutationCount: 2, targetNodeIds: ['x', 'y'] }, 200);
    const s = session.getSummary();
    expect(s.anomalyCount).toBe(1);
    expect(s.anomaliesByReason['mutation-outside-animation']).toBe(1);
    expect(stream.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'perception-anomaly',
        timestamp: 200,
        payload: expect.objectContaining({ tier: 'frame', reason: 'mutation-outside-animation' }),
      }),
    );
  });

  it('recordEscalation increments escalationCount', async () => {
    await session.start(100);
    session.recordEscalation('frame', 'semantic', 'mutation-outside-animation', [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }], 250);
    expect(session.getSummary().escalationCount).toBe(1);
    expect(stream.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'perception-escalation',
        timestamp: 250,
        payload: expect.objectContaining({ from: 'frame', to: 'semantic' }),
      }),
    );
  });

  it('recordIntentResult increments intentResultCount + vlmCalls.count', async () => {
    await session.start(100);
    session.recordIntentResult(
      { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
      'AnimatedCounter',
      300,
      400,
    );
    const s = session.getSummary();
    expect(s.intentResultCount).toBe(1);
    expect(s.vlmCalls.count).toBe(1);
    expect(stream.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'perception-intent-result',
        timestamp: 400,
        payload: expect.objectContaining({ classification: 'AnimatedCounter', classificationSource: 'vlm', durationMs: 300 }),
      }),
    );
  });

  it('averageCadenceMs computes mean inter-tick interval per tier', async () => {
    await session.start(0);
    session.recordTick('frame', 'keyframe', 100);
    session.recordTick('frame', 'keyframe', 300);   // gap 200
    session.recordTick('frame', 'keyframe', 500);   // gap 200
    const s = session.getSummary();
    expect(s.averageCadenceMs.frame).toBe(200);
    expect(s.averageCadenceMs.semantic).toBeNull();
    expect(s.averageCadenceMs.intent).toBeNull();
  });

  it('internalEmitter is a usable EventEmitter', async () => {
    const handler = vi.fn();
    session.internalEmitter.on('escalate', handler);
    session.internalEmitter.emit('escalate', { from: 'frame', regions: [] });
    expect(handler).toHaveBeenCalledWith({ from: 'frame', regions: [] });
  });

  it('anomaliesByReason buckets initialized to zero even when no anomaly fired', () => {
    const s = session.getSummary();
    expect(s.anomaliesByReason['mutation-outside-animation']).toBe(0);
  });

  it('durationMs is 0 before start()', () => {
    const s = session.getSummary();
    expect(s.durationMs).toBe(0);
  });
});

describe('PerceptionSession composed with loops', () => {
  function mkComposedDeps() {
    const stream = new NodeEventEmitter() as any;
    stream.push = vi.fn();
    const frameCapture = new NodeEventEmitter() as any;
    const indexer = { run: vi.fn(async () => new Map()) } as any;
    const structuralPipeline = { extractStructure: vi.fn(async () => []) } as any;
    const page = {
      url: () => 'http://test',
      on: vi.fn(),
      off: vi.fn(),
      exposeFunction: vi.fn(async () => {}),
      evaluate: vi.fn(async () => {}),
    } as any;
    const classifyByVlm = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => Buffer.from([0x89, 0x50]));
    return { stream, frameCapture, indexer, structuralPipeline, page, classifyByVlm, getScreenshot };
  }

  it('start() registers framenavigated and close handlers on the page', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    expect(deps.page.on).toHaveBeenCalledWith('framenavigated', expect.any(Function));
    expect(deps.page.on).toHaveBeenCalledWith('close', expect.any(Function));
    session.stop(100);
  });

  it('stop() runs all teardown steps even when one throws (P2-C2 fix)', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });

    // Inject a throwing frameLoop.stop() to model TargetClosedError during teardown.
    const frameLoopStop = vi.spyOn((session as any).frameLoop, 'stop')
      .mockImplementation(() => { throw new Error('frameLoop teardown failed'); });
    const semanticLoopStop = vi.spyOn((session as any).semanticLoop, 'stop');
    const intentLoopStop = vi.spyOn((session as any).intentLoop, 'stop');

    let thrown: unknown = null;
    try { session.stop(100); } catch (e) { thrown = e; }

    // All teardown steps must run regardless of the throw.
    expect(frameLoopStop).toHaveBeenCalled();
    expect(semanticLoopStop).toHaveBeenCalled();
    expect(intentLoopStop).toHaveBeenCalled();
    expect(deps.page.off).toHaveBeenCalledWith('framenavigated', expect.any(Function));
    expect(deps.page.off).toHaveBeenCalledWith('close', expect.any(Function));

    // Refs must all be nulled — session left in a coherent stopped state,
    // not bricked half-way.
    expect((session as any).frameLoop).toBeNull();
    expect((session as any).semanticLoop).toBeNull();
    expect((session as any).intentLoop).toBeNull();
    expect((session as any).page).toBeNull();

    // The underlying error is still surfaced (aggregated), not swallowed.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/frameLoop teardown failed/);
  });

  it('stop() aggregates multiple teardown failures in order and preserves their causes (P3-I3, test gap B)', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });

    // Two distinct teardown steps throw — a generic Error and a TypeError, so
    // we can prove both the type and the per-step identity survive aggregation.
    const frameErr = new Error('frameLoop boom');
    const semanticErr = new TypeError('semanticLoop type boom');
    vi.spyOn((session as any).frameLoop, 'stop').mockImplementation(() => { throw frameErr; });
    vi.spyOn((session as any).semanticLoop, 'stop').mockImplementation(() => { throw semanticErr; });

    let thrown: unknown = null;
    try { session.stop(100); } catch (e) { thrown = e; }

    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error;
    // Grep-friendly step labels remain, in execution order.
    expect(err.message).toMatch(/frameLoop\.stop:.*semanticLoop\.stop:/s);
    // P3-I3: the underlying errors are preserved via `cause` (full stacks +
    // original types), not collapsed to just their `.message` strings.
    expect(Array.isArray(err.cause)).toBe(true);
    const causes = err.cause as Array<{ label: string; err: unknown }>;
    expect(causes.map((c) => c.label)).toEqual(['frameLoop.stop', 'semanticLoop.stop']);
    expect(causes[0].err).toBe(frameErr);
    expect(causes[1].err).toBe(semanticErr);
    // The TypeError type survives — previously lost when only .message was kept.
    expect(causes[1].err).toBeInstanceOf(TypeError);
  });

  it('stop() cleanly removes page listeners', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    session.stop(100);
    expect(deps.page.off).toHaveBeenCalledWith('framenavigated', expect.any(Function));
    expect(deps.page.off).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('navigation event resets sessionStartMs and emits a navigation-reset tick', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    // Find and invoke the framenavigated handler registered by the session (onPageNav).
    // FrameLoop also registers its own framenavigated handler; we want the session's one
    // which resets startedAt and emits the navigation-reset tick.
    const navCalls = deps.page.on.mock.calls.filter((c: any[]) => c[0] === 'framenavigated');
    // Session's onPageNav is the one registered directly by session.start (not FrameLoop).
    // It is always the last call because FrameLoop.start() runs before the session's page.on.
    // We identify it by invoking all and checking the tick was emitted.
    for (const [, handler] of navCalls) {
      handler();
    }
    expect(deps.stream.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'perception-tick',
        payload: expect.objectContaining({ tier: 'frame', cause: 'navigation-reset' }),
      }),
    );
    session.stop(100);
  });

  it('page close auto-stops the session', async () => {
    const deps = mkComposedDeps();
    const session = new PerceptionSession({ eventStream: deps.stream });
    await session.start(0, {
      page: deps.page,
      frameCapture: deps.frameCapture,
      indexer: deps.indexer,
      structuralPipeline: deps.structuralPipeline,
      classifyByVlm: deps.classifyByVlm,
      getScreenshot: deps.getScreenshot,
    });
    const closeHandler = deps.page.on.mock.calls.find((c: any[]) => c[0] === 'close')[1];
    closeHandler();
    expect(session.isRunning()).toBe(false);
  });
});
