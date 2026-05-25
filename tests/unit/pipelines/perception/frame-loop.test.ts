import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { FrameLoop } from '../../../../src/pipelines/perception/frame-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';
import type { KeyframeEvent } from '../../../../src/types/temporal.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeFrameCapture extends EventEmitter {
  emitKeyframe(timestamp: number, frame = Buffer.from([0x89, 0x50])): void {
    const kf: KeyframeEvent = { frame, timestamp, trigger: 'significant_diff' };
    this.emit('keyframe', kf);
  }
}

/**
 * FakeEventStream extends EventEmitter so that calling `push()` emits the
 * 'event' signal — matching the real TemporalEventStream's behaviour after
 * adding EventEmitter support in Task 4.
 */
class FakeEventStream extends EventEmitter {
  push = vi.fn((event: TimelineEvent) => {
    // Mirror real stream: emit so FrameLoop can subscribe.
    this.emit('event', event);
  });

  /** Convenience: emit a timeline event as if a collector pushed it.
   *  Payload is typed as `unknown` here to avoid complex conditional-type
   *  inference in tests; the real stream is strongly typed. */
  pushEvent(type: TimelineEvent['type'], payload: unknown, timestamp = 100): void {
    const event = { id: randomUUID(), type, timestamp, payload } as TimelineEvent;
    this.push(event);
  }
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function setup(config?: { lookbackMs?: number; coalesceWindowMs?: number; warmupMs?: number }) {
  const stream = new FakeEventStream();
  const session = new PerceptionSession({
    eventStream: stream as unknown as TemporalEventStream,
  });
  const frameCapture = new FakeFrameCapture();
  const loop = new FrameLoop({
    session,
    frameCapture: frameCapture as any,
    eventStream: stream as unknown as TemporalEventStream,
    // no `page` — page-side observer not installed in unit tests
    config,
  });
  return { stream, session, frameCapture, loop };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrameLoop', () => {
  it('emits perception-tick { tier: frame, cause: keyframe } on each keyframe', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    await session.start(0);
    await loop.start();

    frameCapture.emitKeyframe(50);

    const ticks = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].payload).toMatchObject({ tier: 'frame', cause: 'keyframe' });
  });

  it('tracks animation-start/end and suppresses anomaly while animation is active', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    await session.start(0);
    await loop.start();

    // Start animation, add a mutation, fire keyframe — no anomaly expected.
    stream.pushEvent('animation-start', { animationId: 'a-1', duration: 300 }, 50);
    loop.addMutationForTest(80, 'node-x');
    frameCapture.emitKeyframe(100);

    const anomalies = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-anomaly');
    expect(anomalies).toHaveLength(0);

    // End animation; new mutation now triggers anomaly.
    stream.pushEvent('animation-end', { animationId: 'a-1', reason: 'completed' }, 200);
    loop.addMutationForTest(220, 'node-y');
    frameCapture.emitKeyframe(240);

    const anomalies2 = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-anomaly');
    expect(anomalies2).toHaveLength(1);
  });

  it('emits perception-anomaly and perception-escalation when detector fires', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    await session.start(0);
    await loop.start();

    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(120);

    const events = stream.push.mock.calls.map((c) => c[0]);
    const anomaly = events.find((e) => e.type === 'perception-anomaly');
    const escalation = events.find((e) => e.type === 'perception-escalation');

    expect(anomaly).toBeDefined();
    expect(anomaly!.payload).toMatchObject({ tier: 'frame', reason: 'mutation-outside-animation' });
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toMatchObject({ from: 'frame', to: 'semantic' });
  });

  it('emits escalate on internalEmitter for the semantic loop', async () => {
    const { session, frameCapture, loop } = setup({ warmupMs: 0 });
    const handler = vi.fn();
    session.internalEmitter.on('escalate', handler);
    await session.start(0);
    await loop.start();

    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(120);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'frame' }),
    );
  });

  it('trims recentMutations older than lookbackMs', async () => {
    const { session, frameCapture, loop, stream } = setup({ lookbackMs: 100, warmupMs: 0 });
    await session.start(0);
    await loop.start();

    // Mutation at t=0, keyframe at t=500 → gap 500 > lookbackMs 100
    loop.addMutationForTest(0, 'node-old');
    frameCapture.emitKeyframe(500);

    const anomalies = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-anomaly');
    expect(anomalies).toHaveLength(0);
  });

  it('debounces back-to-back keyframes within coalesce window', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0, coalesceWindowMs: 100 });
    await session.start(0);
    await loop.start();

    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(110);   // anomaly fires
    frameCapture.emitKeyframe(150);   // 150 - 110 = 40 < coalesceWindowMs 100 → suppressed

    const anomalies = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-anomaly');
    expect(anomalies).toHaveLength(1);
  });

  it('stop() unsubscribes from frameCapture and eventStream', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 0 });
    await session.start(0);
    await loop.start();
    loop.stop();

    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(120);

    // After stop(), no ticks should be recorded.
    const ticks = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-tick');
    expect(ticks).toHaveLength(0);
  });

  it('warmup gate suppresses anomaly before warmupMs elapses', async () => {
    const { session, frameCapture, loop, stream } = setup({ warmupMs: 500 });
    await session.start(0);
    await loop.start();

    // Mutation at t=100, keyframe at t=200 — still within 500ms warmup
    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(200);

    const anomalies = stream.push.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'perception-anomaly');
    expect(anomalies).toHaveLength(0);
  });

  it('addMutationForTest populates recentMutations ring buffer', async () => {
    const { loop } = setup();
    loop.addMutationForTest(50, 'node-1');
    loop.addMutationForTest(60, 'node-2');

    const buf = loop.getRecentMutationsForTest();
    expect(buf).toHaveLength(2);
    expect(buf[0]).toEqual({ timestamp: 50, targetNodeId: 'node-1' });
  });
});

// ---------------------------------------------------------------------------
// Page-side observer install + lifecycle tests
//
// These exercise the FrameLoop paths that use a Playwright Page. The pure
// unit tests above pass `page: undefined` and never touch installPageObserver
// or the framenavigated handler — meaning the two highest-priority fixes from
// commit 4e53077 (framenavigated reinstall + WeakMap dispatcher) had ZERO
// regression coverage. The block below locks both in, plus the C3 fix that
// catches errors in the fire-and-forget nav listener.
// ---------------------------------------------------------------------------

/** Minimal Page mock — just the surface FrameLoop uses. */
class FakePage extends EventEmitter {
  exposeFunction = vi.fn<(name: string, fn: (...args: any[]) => any) => Promise<void>>(
    async (name: string, fn: (...args: any[]) => any) => {
      this.exposedFns.set(name, fn);
    },
  );
  evaluate = vi.fn<(fn: (...args: any[]) => any) => Promise<unknown>>(async () => undefined);
  exposedFns = new Map<string, (...args: any[]) => any>();
}

function setupWithPage(config?: { warmupMs?: number; lookbackMs?: number; coalesceWindowMs?: number }) {
  const stream = new FakeEventStream();
  const session = new PerceptionSession({
    eventStream: stream as unknown as TemporalEventStream,
  });
  const frameCapture = new FakeFrameCapture();
  const page = new FakePage();
  const loop = new FrameLoop({
    session,
    frameCapture: frameCapture as any,
    eventStream: stream as unknown as TemporalEventStream,
    page: page as unknown as Page,
    config,
  });
  return { stream, session, frameCapture, page, loop };
}

describe('FrameLoop page-side observer', () => {
  it('reinstalls the page-side observer when framenavigated fires (regression lock for 4e53077 fix #1)', async () => {
    const { session, page, loop } = setupWithPage({ warmupMs: 0 });
    await session.start(0);
    await loop.start();

    // Sanity: initial install ran once.
    expect(page.evaluate).toHaveBeenCalledTimes(1);

    // Simulate Playwright's SPA navigation event.
    page.emit('framenavigated');
    // The handler is async; drain microtasks so the await completes.
    await new Promise((r) => setImmediate(r));

    // Observer must be reinstalled — evaluate ran a second time.
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('WeakMap dispatcher routes mutations to the current FrameLoop on second-session reattach (regression lock for 4e53077 fix #2)', async () => {
    const { session: s1, page, loop: loop1 } = setupWithPage({ warmupMs: 0 });
    await s1.start(0);
    await loop1.start();

    // Capture the closure that exposeFunction registered on the page side.
    const exposedClosure = page.exposedFns.get('__uipeFrameLoopMutation');
    expect(exposedClosure).toBeDefined();

    loop1.stop();

    // Second session on the same page. exposeFunction throws "already
    // registered" (the closure from loop1 is still bound on the page).
    page.exposeFunction.mockImplementationOnce(async () => {
      throw new Error('Function "__uipeFrameLoopMutation" has been already registered');
    });

    const stream2 = new FakeEventStream();
    const session2 = new PerceptionSession({
      eventStream: stream2 as unknown as TemporalEventStream,
    });
    const frameCapture2 = new FakeFrameCapture();
    const loop2 = new FrameLoop({
      session: session2,
      frameCapture: frameCapture2 as any,
      eventStream: stream2 as unknown as TemporalEventStream,
      page: page as unknown as Page,
      config: { warmupMs: 0 },
    });
    await session2.start(100);
    await loop2.start();

    // Invoke the OLD closure (still bound from loop1's exposeFunction call).
    exposedClosure!({ timestamp: 200, targetNodeId: 'mut-7' });

    // The mutation must land in loop2's buffer via the WeakMap redirect.
    const buf = loop2.getRecentMutationsForTest();
    expect(buf).toEqual([{ timestamp: 200, targetNodeId: 'mut-7' }]);
    loop2.stop();
  });

  it('framenavigated reinstall errors are caught and logged, not unhandled rejections (C3 fix)', async () => {
    const { session, page, loop } = setupWithPage({ warmupMs: 0 });
    await session.start(0);
    await loop.start();

    // After the initial install, make the next evaluate reject — simulating
    // a TargetClosedError mid-nav, a sharp crash, etc.
    page.evaluate.mockRejectedValueOnce(new Error('Target page closed during nav'));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      page.emit('framenavigated');
      // Drain both the framenavigated callback and the rejected-promise tick.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(unhandled).toEqual([]);
      // Loop is still alive — keyframe handling continues.
      const frameCapture = (loop as any).frameCapture as FakeFrameCapture;
      frameCapture.emitKeyframe(50);
      expect((loop as any).recentMutations).toBeDefined();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      loop.stop();
    }
  });
});
