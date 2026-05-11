import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { FlowProducer, type SidecarSpawner } from '../../../../src/pipelines/temporal/producers/optical-flow.js';

class StubChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killed = false;
  constructor() {
    super();
    this.stdin = new Writable({ write: (_chunk, _enc, cb) => cb() });
    this.stdout = new Readable({ read: () => {} });
    this.stderr = new Readable({ read: () => {} });
  }
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0, null));
    return true;
  }
}

describe('FlowProducer lifecycle', () => {
  let spawned: StubChild[];
  let spawner: SidecarSpawner;

  beforeEach(() => {
    spawned = [];
    spawner = vi.fn(() => {
      const child = new StubChild();
      spawned.push(child);
      return child as never;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not spawn until start() is called', () => {
    new FlowProducer({ binaryPath: '/fake', spawner });
    expect(spawned.length).toBe(0);
  });

  it('spawns the sidecar on start()', async () => {
    const producer = new FlowProducer({ binaryPath: '/fake', spawner });
    await producer.start();
    expect(spawned.length).toBe(1);
    await producer.stop();
  });

  it('restarts after sidecar crash with exponential backoff', async () => {
    vi.useFakeTimers();
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
      maxConsecutiveFailures: 3,
    });
    await producer.start();
    expect(spawned.length).toBe(1);

    spawned[0]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15);
    expect(spawned.length).toBe(2);

    spawned[1]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(25);
    expect(spawned.length).toBe(3);

    await producer.stop();
    vi.useRealTimers();
  });

  it('disables itself after maxConsecutiveFailures', async () => {
    vi.useFakeTimers();
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
      maxConsecutiveFailures: 2,
    });
    await producer.start();
    spawned[0]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(2);
    spawned[1]!.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(5);
    expect(producer.disabled).toBe(true);
    await producer.stop();
    vi.useRealTimers();
  });
});

import { EventEmitter as EE2 } from 'node:events';

class StubFrameCapture extends EE2 {
  publish(keyframe: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', keyframe);
  }
}

function pngStub(value: number): Buffer {
  return Buffer.from([value, 0xff, 0xee]);
}

describe('FlowProducer pHash gating', () => {
  let spawner: SidecarSpawner;
  let spawned: StubChild[];

  beforeEach(() => {
    spawned = [];
    spawner = vi.fn(() => {
      const child = new StubChild();
      spawned.push(child);
      return child as never;
    });
  });

  it('drops a frame when pHash Hamming distance is below threshold', async () => {
    const capture = new StubFrameCapture();
    const writes: Buffer[] = [];
    const producer = new FlowProducer({
      binaryPath: '/fake',
      spawner,
      phashThreshold: 5,
    });
    producer.attachFrameSource(capture as never);
    await producer.start();
    const child = spawned[0]!;
    (child.stdin as { write: (b: Buffer) => boolean }).write = (b: Buffer) => {
      writes.push(b);
      return true;
    };

    // First frame is always accepted (no prior to compare against)
    capture.publish({ pngBytes: pngStub(1), phash: 0b0000n, timestamp: 100 });
    // Second frame: identical pHash → Hamming distance 0 → drop
    capture.publish({ pngBytes: pngStub(2), phash: 0b0000n, timestamp: 116 });
    // Third frame: 6 differing bits → Hamming distance 6 → accept
    capture.publish({ pngBytes: pngStub(3), phash: 0b111111n, timestamp: 132 });

    await new Promise((r) => setImmediate(r));

    // First and third forwarded; second dropped. Each forwarded frame is
    // length-prefix + bytes, so we expect 2 writes (or 4 if length and body are separate).
    const total = Buffer.concat(writes).length;
    expect(total).toBeGreaterThan(0);
    expect(producer.framesAccepted).toBe(2);
    expect(producer.framesDropped).toBe(1);
    await producer.stop();
  });
});
