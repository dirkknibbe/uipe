import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FlowProducer } from '../src/pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../src/pipelines/temporal/event-stream.js';
import type { OpticalFlowMotionPayload } from '../src/pipelines/temporal/collectors/types.js';
import type { Page } from 'playwright';
import sharp from 'sharp';

interface SyntheticFixture {
  name: string;
  generate: (frame: number) => Promise<Buffer>;
  frameCount: number;
  expectedPattern: string;
}

const FIXTURES: SyntheticFixture[] = [
  {
    name: 'translation-right',
    frameCount: 8,
    expectedPattern: 'translation',
    generate: async (frame) => paintRectangle(8 * frame, 0),
  },
  {
    name: 'translation-down',
    frameCount: 8,
    expectedPattern: 'translation',
    generate: async (frame) => paintRectangle(0, 8 * frame),
  },
  {
    name: 'expand',
    frameCount: 8,
    expectedPattern: 'scale',
    generate: async (frame) => paintRectangle(0, 0, 32 + 4 * frame),
  },
];

async function paintRectangle(dx: number, dy: number, size = 32): Promise<Buffer> {
  const w = 128;
  const h = 128;
  const channels = 3;
  const data = Buffer.alloc(w * h * channels, 50);
  const left = 32 + dx;
  const top = 32 + dy;
  for (let y = top; y < top + size; y += 1) {
    for (let x = left; x < left + size; x += 1) {
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const idx = (y * w + x) * channels;
      data[idx] = 230;
      data[idx + 1] = 230;
      data[idx + 2] = 230;
    }
  }
  return await sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

function fakePage(): Page {
  return { on: () => {}, off: () => {}, evaluate: async () => 0, exposeFunction: async () => {} } as unknown as Page;
}

class StubFrameCapture extends EventEmitter {
  publish(kf: { pngBytes: Buffer; phash: bigint; timestamp: number }): void {
    this.emit('keyframe', kf);
  }
}

async function runFixture(bin: string, fixture: SyntheticFixture): Promise<{ regionCount: number; motionCount: number; classifications: string[]; latencies: number[] }> {
  const stream = new TemporalEventStream({ capacity: 10_000 });
  const capture = new StubFrameCapture();
  const latencies: number[] = [];

  const producer = new FlowProducer({
    binaryPath: bin,
    spawner: (b, args) => spawn(b, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
    phashThreshold: 0,
  });
  const collector = new FlowCollector(producer);
  producer.attachFrameSource(capture);
  await producer.start();
  await stream.attach(fakePage(), [collector]);

  for (let i = 0; i < fixture.frameCount; i += 1) {
    const png = await fixture.generate(i);
    const start = performance.now();
    capture.publish({ pngBytes: png, phash: BigInt(i), timestamp: i * 16 });
    // Wait until at least one event arrives or 1s elapses
    await new Promise((r) => setTimeout(r, 200));
    latencies.push(performance.now() - start);
  }

  await new Promise((r) => setTimeout(r, 500));
  const regions = stream.getEvents({ types: ['optical-flow-region'] });
  const motions = stream.getEvents({ types: ['optical-flow-motion'] });

  await producer.stop();
  await collector.detach();

  return {
    regionCount: regions.length,
    motionCount: motions.length,
    classifications: motions.map((m) => (m.payload as OpticalFlowMotionPayload).pattern),
    latencies,
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const bin = resolve(process.cwd(), 'target/release/uipe-vision');
  if (!existsSync(bin)) {
    console.error(`Binary missing: ${bin}. Run 'pnpm run build:rust' first.`);
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push('fixture\texpected\tobserved\tregions\tmotions\tp50_ms\tp95_ms');
  for (const fixture of FIXTURES) {
    const result = await runFixture(bin, fixture);
    const observed = result.classifications[0] ?? '<none>';
    const p50 = percentile(result.latencies, 50);
    const p95 = percentile(result.latencies, 95);
    lines.push([
      fixture.name,
      fixture.expectedPattern,
      observed,
      result.regionCount,
      result.motionCount,
      p50.toFixed(1),
      p95.toFixed(1),
    ].join('\t'));
  }
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
