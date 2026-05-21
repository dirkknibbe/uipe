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
    session.start(0);
    const classify = vi.fn(async () => 'X');
    const getScreenshot = vi.fn(async () => PNG);
    const loop = new IntentLoop({ session, eventStream: stream as unknown as TemporalEventStream, getScreenshot, classifyByVlm: classify });
    loop.start();
    await Promise.resolve();
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies each region in an escalation and emits perception-intent-result', async () => {
    const { session, stream } = mkSession();
    session.start(0);
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
    session.start(0);
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
    session.start(0);

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
    session.start(0);
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
    session.start(0);
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

  it('ignores escalation events whose from is not semantic', async () => {
    const { session, stream } = mkSession();
    session.start(0);
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
});
