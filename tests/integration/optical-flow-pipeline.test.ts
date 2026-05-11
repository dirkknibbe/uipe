import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { FlowProducer } from '../../src/pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../../src/pipelines/temporal/event-stream.js';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import type { Page } from 'playwright';

const BIN = resolve(process.cwd(), 'target/release/uipe-vision');
const MODEL = resolve(process.cwd(), 'crates/uipe-vision/models/raft-small-int8.onnx');

class StubFrameCapture extends EventEmitter {
  publish(keyframe: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', keyframe);
  }
}

function fakePage(): Page {
  return {
    on: () => {},
    off: () => {},
    evaluate: async () => 0,
    exposeFunction: async () => {},
  } as unknown as Page;
}

async function generateFrame(translateX: number): Promise<Buffer> {
  // Solid-grey background with a single bright rectangle at offset
  const w = 128;
  const h = 128;
  const channels = 3;
  const data = Buffer.alloc(w * h * channels, 50);
  for (let y = 32; y < 64; y += 1) {
    for (let x = 32 + translateX; x < 64 + translateX; x += 1) {
      if (x < 0 || x >= w) continue;
      const idx = (y * w + x) * channels;
      data[idx] = 230;
      data[idx + 1] = 230;
      data[idx + 2] = 230;
    }
  }
  return await sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

const modelAvailable = existsSync(BIN) && existsSync(MODEL);

describe.skipIf(!modelAvailable)('optical-flow pipeline integration', () => {
  it('produces region and motion events for a translated rectangle pair', async () => {
    const stream = new TemporalEventStream({ capacity: 1000 });
    const capture = new StubFrameCapture();
    const producer = new FlowProducer({
      binaryPath: BIN,
      spawner: (bin, args) => spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
      phashThreshold: 0, // accept every frame in this test
    });
    const collector = new FlowCollector(producer);
    producer.attachFrameSource(capture);
    await producer.start();
    await stream.attach(fakePage(), [collector]);

    const frame_a = await generateFrame(0);
    const frame_b = await generateFrame(8);

    capture.publish({ pngBytes: frame_a, phash: 0n, timestamp: 100 });
    capture.publish({ pngBytes: frame_b, phash: 0xfffn, timestamp: 116 });

    // Wait for the sidecar to produce events
    await new Promise((r) => setTimeout(r, 3000));

    const regionEvents = stream.getEvents({ types: ['optical-flow-region'] });
    expect(regionEvents.length).toBeGreaterThan(0);

    const motionEvents = stream.getEvents({ types: ['optical-flow-motion'] });
    expect(motionEvents.length).toBeGreaterThan(0);
    expect(
      motionEvents.some((e) => {
        const payload = e.payload as any;
        return payload.pattern === 'translation';
      })
    ).toBe(true);

    await producer.stop();
    await collector.detach();
  }, 30_000);
});
