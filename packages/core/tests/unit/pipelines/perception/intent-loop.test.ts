import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';

// ---------------------------------------------------------------------------
// Sharp mock — must be hoisted before imports that use sharp
// ---------------------------------------------------------------------------

vi.mock('sharp', () => {
  // Stub: sharp(buf).extract(...).png().toBuffer() returns a fixed PNG buffer
  const sharpMock = vi.fn(() => ({
    extract: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  }));
  return { default: sharpMock };
});

import { IntentLoop } from '../../../../src/pipelines/perception/intent-loop.js';
import { PerceptionSession } from '../../../../src/pipelines/perception/session.js';
import type { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeEventStream extends EventEmitter {
  push = vi.fn((_event: TimelineEvent) => {
    // no-op in unit tests
  });
}

function mkSession() {
  const stream = new FakeEventStream();
  const session = new PerceptionSession({
    eventStream: stream as unknown as TemporalEventStream,
  });
  return { session, stream };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// ---------------------------------------------------------------------------
// Helpers to inspect push calls by event type
// ---------------------------------------------------------------------------

function intentResultCalls(stream: FakeEventStream) {
  return stream.push.mock.calls
    .map((c) => c[0])
    .filter((e) => e.type === 'perception-intent-result');
}

function tickCalls(stream: FakeEventStream, tier: string) {
  return stream.push.mock.calls
    .map((c) => c[0])
    .filter((e) => e.type === 'perception-tick' && (e.payload as any).tier === tier);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntentLoop', () => {
  it('does not call VLM unless an escalation arrives', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();
    await Promise.resolve();
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies each region in an escalation and emits perception-intent-result', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'AnimatedCounter');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 50, h: 30 } },
        { nodeId: 'b', bbox: { x: 60, y: 0, w: 50, h: 30 } },
      ],
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(classify).toHaveBeenCalledTimes(2);
    expect(intentResultCalls(stream)).toHaveLength(2);
  });

  it('emits a single perception-tick for the drain (not per-region)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
      ],
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(tickCalls(stream, 'intent')).toHaveLength(1);
  });

  it('drops oldest when pending queue exceeds maxPending', async () => {
    const { session, stream } = mkSession();
    await session.start(0);

    // classifier that never resolves until we call resolveClassify
    let resolveClassify: (v: string) => void = () => {};
    const classify = vi.fn(
      () => new Promise<string>((r) => { resolveClassify = r; }),
    );
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      getScreenshot,
      classifyByVlm: classify,
      config: { maxPending: 2 },
    });
    loop.start();

    // Fire 5 escalations — first starts immediately (drain picks it up),
    // next ones queue up, exceeding maxPending=2 so oldest get dropped.
    for (let i = 0; i < 5; i++) {
      session.internalEmitter.emit('escalate', {
        from: 'semantic',
        regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
      });
    }
    // Let the first drain start
    await Promise.resolve();

    // Unblock the in-flight classifier
    resolveClassify('X');
    // Let the rest drain
    await new Promise((r) => setTimeout(r, 20));

    // With maxPending=2, at most 3 items can complete (1 in-flight + 2 in queue)
    // But drops mean fewer. Assert it's strictly less than 5 (dropped at least some).
    expect(intentResultCalls(stream).length).toBeLessThan(5);
  });

  it('skips classification when screenshot provider returns null', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => null);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(classify).not.toHaveBeenCalled();
  });

  it('continues past a per-region classifier error', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => 'OK');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [
        { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
      ],
    });

    await new Promise((r) => setTimeout(r, 0));

    const successful = intentResultCalls(stream).filter(
      (e) => (e.payload as any).classification === 'OK',
    );
    expect(successful).toHaveLength(1);
  });

  it('records vlmCalls.errorCount and preserves error stack on classify failure (I2 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => { throw new Error('vlm-boom'); });
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      session.internalEmitter.emit('escalate', {
        from: 'semantic',
        regions: [
          { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
          { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      // Summary surfaces the error count (additive optional field).
      const summary = session.getSummary();
      expect(summary.vlmCalls.errorCount).toBe(2);

      // Log call preserves the stack instead of collapsing to `Error: msg`.
      const errorLog = logSpy.mock.calls.find((call) => {
        const [prefix, message] = call;
        return (
          typeof prefix === 'string' &&
          prefix.includes('[WARN]') &&
          typeof message === 'string' &&
          /classification failed/i.test(message)
        );
      });
      expect(errorLog).toBeDefined();
      const data = errorLog?.[2] as { error?: string };
      expect(typeof data?.error).toBe('string');
      // A real stack contains a frame; `String(new Error("x"))` is just `Error: x`.
      expect(data!.error).toMatch(/\bat\b/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not record intent results when stop() arrives during an in-flight classify (C1 regression lock for 4e53077 fix #5)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    let resolveClassify: (v: string) => void = () => {};
    const classify = vi.fn(
      () => new Promise<string>((r) => { resolveClassify = r; }),
    );
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      getScreenshot,
      classifyByVlm: classify,
    });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });

    // Let the drain reach the classify await.
    await Promise.resolve();
    await Promise.resolve();

    // Stop while the VLM call is in flight.
    loop.stop();

    // Now resolve the classify — the result must NOT be recorded.
    resolveClassify('LateAnswer');
    await new Promise((r) => setTimeout(r, 10));

    expect(intentResultCalls(stream)).toHaveLength(0);
  });

  it('logs a warning when getScreenshot returns null instead of silently dropping the pending queue (silent-failure #5)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => null);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      session.internalEmitter.emit('escalate', {
        from: 'semantic',
        regions: [
          { nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
          { nodeId: 'b', bbox: { x: 20, y: 0, w: 10, h: 10 } },
        ],
      });
      await new Promise((r) => setTimeout(r, 0));

      const warned = logSpy.mock.calls.some((call) => {
        const [prefix, message] = call;
        return (
          typeof prefix === 'string' &&
          prefix.includes('[WARN]') &&
          typeof message === 'string' &&
          /screenshot/i.test(message)
        );
      });
      expect(warned).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not bump vlmCalls.errorCount when stop() arrives during an in-flight classify that later throws (P2-I1 fix)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    let rejectClassify: (e: Error) => void = () => {};
    let classifyCalled: () => void = () => {};
    const classifyEntered = new Promise<void>((r) => { classifyCalled = r; });
    const classify = vi.fn(
      () => new Promise<string>((_, rej) => {
        rejectClassify = rej;
        classifyCalled();
      }),
    );
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({
      session,
      eventStream: stream as unknown as TemporalEventStream,
      getScreenshot,
      classifyByVlm: classify,
    });
    const recordVlmErrorSpy = vi.spyOn(session, 'recordVlmError');
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'semantic',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });

    // Wait for classify to actually be entered — only then is rejectClassify
    // a real reject fn. Avoids the microtask-timing flake of Promise.resolve.
    await classifyEntered;

    // Stop while the VLM call is in flight.
    loop.stop();

    // Now make the in-flight classify REJECT. recordVlmError must NOT be
    // called against a stopped session — mirroring how the success-path
    // recordIntentResult is gated by !this.running.
    rejectClassify(new Error('vlm-late-fail'));
    await new Promise((r) => setTimeout(r, 10));

    expect(recordVlmErrorSpy).not.toHaveBeenCalled();
    expect(session.getSummary().vlmCalls.errorCount).toBeUndefined();
  });

  it('logs when getScreenshot throws and does not produce an unhandled rejection (G1)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => { throw new Error('target closed'); });
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => unhandled.push(r);
    process.on('unhandledRejection', onUnhandled);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      session.internalEmitter.emit('escalate', {
        from: 'semantic',
        regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(unhandled).toEqual([]);
      const errored = logSpy.mock.calls.some((c) => {
        const [prefix, msg] = c;
        return typeof prefix === 'string' && prefix.includes('[ERROR]') &&
               typeof msg === 'string' && /screenshot/i.test(msg);
      });
      expect(errored).toBe(true);
      expect(classify).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      logSpy.mockRestore();
    }
  });

  it('bounds error log volume when getScreenshot perma-throws (P2-C1 circuit breaker, G2)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => { throw new Error('target closed'); });
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      // Fire 20 escalations; each kicks a drain that hits the throwing
      // screenshot. Without bounding, this produces 20 ERROR lines.
      for (let i = 0; i < 20; i++) {
        session.internalEmitter.emit('escalate', {
          from: 'semantic',
          regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
        });
        await new Promise((r) => setTimeout(r, 0));
      }

      const errorLogs = logSpy.mock.calls.filter((c) => {
        const [prefix, msg] = c;
        return typeof prefix === 'string' && prefix.includes('[ERROR]') &&
               typeof msg === 'string' && /screenshot/i.test(msg);
      });
      // Circuit breaker bounds total per-failure ERROR lines to at most
      // a small constant (threshold + the "suppressing" notice) regardless
      // of how many escalations arrived.
      expect(errorLogs.length).toBeLessThanOrEqual(5);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('drain() returns immediately when invoked after stop (belt-and-suspenders guard)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    // Simulate the race: an enqueue happens, then stop runs, then a stale
    // drain kicks. (We splice pending directly to model "post-stop pending"
    // since the real onEscalate path is unsubscribed by stop().)
    (loop as any).pending.push({ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } });
    loop.stop();
    // Refill pending to simulate a queued item surviving stop.
    (loop as any).pending.push({ nodeId: 'b', bbox: { x: 0, y: 0, w: 10, h: 10 } });

    await (loop as any).drain();
    expect(classify).not.toHaveBeenCalled();
    expect(getScreenshot).not.toHaveBeenCalled();
  });

  it('ignores escalation events whose from is not semantic', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();

    session.internalEmitter.emit('escalate', {
      from: 'frame',
      regions: [{ nodeId: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } }],
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(classify).not.toHaveBeenCalled();
  });

  it('counts every screenshot failure in summary.screenshotErrors, even past the log gate (P3-I1)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => { throw new Error('target closed'); });
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      // Fire 7 escalations (> the log threshold of 3) against a perma-throwing
      // screenshot provider. The per-failure log is bounded by the circuit
      // breaker, but the summary metric must count ALL of them — a permanently
      // broken-screenshot session must not look identical to an idle one.
      for (let i = 0; i < 7; i++) {
        session.internalEmitter.emit('escalate', {
          from: 'semantic',
          regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(session.getSummary().screenshotErrors).toBe(7);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('treats a null screenshot as a streak failure: bounds null-path log volume and counts it (P3-I2)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => null);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      // 20 escalations against a perma-null screenshot. Before the fix the null
      // path logged WARN every single time (unbounded) and never touched the
      // streak. After the fix it shares the throw path's suppression streak, so
      // log volume is bounded and every failure is counted.
      for (let i = 0; i < 20; i++) {
        session.internalEmitter.emit('escalate', {
          from: 'semantic',
          regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      const screenshotLogs = logSpy.mock.calls.filter((c) => {
        const [prefix, msg] = c;
        return typeof prefix === 'string' && typeof msg === 'string' && /screenshot/i.test(msg);
      });
      expect(screenshotLogs.length).toBeLessThanOrEqual(5);
      expect(session.getSummary().screenshotErrors).toBe(20);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('resets the screenshot error streak on a successful screenshot so later failures log again (test gap A)', async () => {
    const { session, stream } = mkSession();
    await session.start(0);
    const classify = vi.fn(async () => 'X');
    // Sequence: throw x4 (exhausts threshold=3 + the suppression notice, so a
    // 5th would be silent), then ONE success (call 5) which must reset the
    // streak, then throw again (call 6) which must log at ERROR afresh.
    let call = 0;
    const getScreenshot = vi.fn(async () => {
      call += 1;
      if (call === 5) return PNG; // success resets the streak
      throw new Error('target closed');
    });
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      loop.start();
      for (let i = 0; i < 6; i++) {
        session.internalEmitter.emit('escalate', {
          from: 'semantic',
          regions: [{ nodeId: `n-${i}`, bbox: { x: 0, y: 0, w: 10, h: 10 } }],
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      const errorScreenshotLogs = logSpy.mock.calls.filter((c) => {
        const [prefix, msg] = c;
        return typeof prefix === 'string' && prefix.includes('[ERROR]') &&
               typeof msg === 'string' && /screenshot/i.test(msg);
      });
      // Run 1 (calls 1-4): 3 per-failure ERROR + 1 suppression ERROR = 4.
      // Run 2 (call 6, after the reset): 1 fresh ERROR. Without the reset,
      // call 6 would be streak=6 → silent → only 4 total.
      expect(errorScreenshotLogs.length).toBe(5);
    } finally {
      logSpy.mockRestore();
    }
  });
});
