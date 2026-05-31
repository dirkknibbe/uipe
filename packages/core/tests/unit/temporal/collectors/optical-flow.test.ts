import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { FlowCollector } from '../../../../src/pipelines/temporal/collectors/optical-flow.js';
import { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';

class FakeProducer extends EventEmitter {}

function fakePage(): Page {
  return {
    on: vi.fn(),
    off: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(0),
    exposeFunction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

describe('FlowCollector', () => {
  it('has the expected name', () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    expect(collector.name).toBe('optical-flow');
  });

  it('pushes events to the stream on producer emissions', async () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    const stream = new TemporalEventStream({ capacity: 100 });
    await stream.attach(fakePage(), [collector]);

    producer.emit('event', {
      type: 'optical-flow-region',
      ts: 200,
      frameTimestamp: 200,
      regionId: 'r1',
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      primitives: {
        meanVelocity: { vx: 2, vy: 0 },
        divergence: 0,
        curl: 0,
        speedVariance: 0,
        pointCount: 50,
      },
    });

    const events = stream.getEvents({ types: ['optical-flow-region'] });
    expect(events.length).toBe(1);
    const event = events[0]! as any;
    expect(event.payload.regionId).toBe('r1');
    await collector.detach();
  });

  it('ignores events with unknown types', async () => {
    const producer = new FakeProducer();
    const collector = new FlowCollector(producer as never);
    const stream = new TemporalEventStream({ capacity: 100 });
    await stream.attach(fakePage(), [collector]);
    producer.emit('event', { type: 'nope', ts: 0 });
    expect(stream.getEvents({}).length).toBe(0);
    await collector.detach();
  });
});
