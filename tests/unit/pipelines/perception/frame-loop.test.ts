import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
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
    session.start(0);
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
    session.start(0);
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
    session.start(0);
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
    session.start(0);
    await loop.start();

    loop.addMutationForTest(100, 'node-a');
    frameCapture.emitKeyframe(120);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'frame' }),
    );
  });

  it('trims recentMutations older than lookbackMs', async () => {
    const { session, frameCapture, loop, stream } = setup({ lookbackMs: 100, warmupMs: 0 });
    session.start(0);
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
    session.start(0);
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
    session.start(0);
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
    session.start(0);
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
