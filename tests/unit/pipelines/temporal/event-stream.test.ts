import { describe, it, expect } from 'vitest';
import { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';

const makeEvent = (
  id: string,
  type: TimelineEvent['type'],
  timestamp: number,
  payload: any = {}
): TimelineEvent => ({ id, type, timestamp, payload });

describe('TemporalEventStream — buffer and query', () => {
  it('push and getEvents return events sorted by timestamp ascending', () => {
    const stream = new TemporalEventStream({ capacity: 100 });
    stream.push(makeEvent('e2', 'input', 200));
    stream.push(makeEvent('e1', 'mutation', 100));
    stream.push(makeEvent('e3', 'network-request', 300));

    const events = stream.getEvents();
    expect(events.map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('capacity overflow drops oldest events (ring buffer)', () => {
    const stream = new TemporalEventStream({ capacity: 3 });
    stream.push(makeEvent('e1', 'input', 100));
    stream.push(makeEvent('e2', 'input', 200));
    stream.push(makeEvent('e3', 'input', 300));
    stream.push(makeEvent('e4', 'input', 400));

    const events = stream.getEvents();
    expect(events.map(e => e.id)).toEqual(['e2', 'e3', 'e4']);
    expect(stream.size()).toBe(3);
  });

  it('getEvents({since}) filters by timestamp', () => {
    const stream = new TemporalEventStream({ capacity: 100 });
    stream.push(makeEvent('e1', 'input', 100));
    stream.push(makeEvent('e2', 'mutation', 200));
    stream.push(makeEvent('e3', 'network-request', 300));

    const events = stream.getEvents({ since: 200 });
    expect(events.map(e => e.id)).toEqual(['e2', 'e3']);
  });

  it('getEvents({types}) filters by event type', () => {
    const stream = new TemporalEventStream({ capacity: 100 });
    stream.push(makeEvent('e1', 'input', 100));
    stream.push(makeEvent('e2', 'mutation', 200));
    stream.push(makeEvent('e3', 'input', 300));

    const events = stream.getEvents({ types: ['input'] });
    expect(events.map(e => e.id)).toEqual(['e1', 'e3']);
  });

  it('getEvents combines since and types filters', () => {
    const stream = new TemporalEventStream({ capacity: 100 });
    stream.push(makeEvent('e1', 'input', 100));
    stream.push(makeEvent('e2', 'mutation', 200));
    stream.push(makeEvent('e3', 'input', 300));

    const events = stream.getEvents({ since: 150, types: ['input'] });
    expect(events.map(e => e.id)).toEqual(['e3']);
  });

  it('size and clear', () => {
    const stream = new TemporalEventStream({ capacity: 100 });
    expect(stream.size()).toBe(0);
    stream.push(makeEvent('e1', 'input', 100));
    stream.push(makeEvent('e2', 'mutation', 200));
    expect(stream.size()).toBe(2);
    stream.clear();
    expect(stream.size()).toBe(0);
    expect(stream.getEvents()).toEqual([]);
  });

  it('default capacity is 10000', () => {
    const stream = new TemporalEventStream();
    for (let i = 0; i < 10005; i++) {
      stream.push(makeEvent(`e${i}`, 'input', i));
    }
    expect(stream.size()).toBe(10000);
    const events = stream.getEvents();
    expect(events[0].id).toBe('e5');
    expect(events[events.length - 1].id).toBe('e10004');
  });
});

import { vi } from 'vitest';
import type { Page } from 'playwright';

const makeMockPage = (overrides: Partial<Page> = {}): Page => {
  const handlers = new Map<string, Function[]>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: vi.fn(),
    evaluate: vi.fn(async () => 0),
    context: vi.fn(() => ({ newCDPSession: vi.fn(async () => ({ send: vi.fn(), on: vi.fn(), off: vi.fn(), detach: vi.fn() })) })),
    ...overrides,
  } as unknown as Page;
};

describe('TemporalEventStream — attach/detach lifecycle', () => {
  it('attach captures clock anchors and exposes a ClockNormalizer', async () => {
    const stream = new TemporalEventStream();
    const page = makeMockPage();

    await stream.attach(page);

    const normalizer = stream.getNormalizer();
    expect(normalizer).toBeDefined();
    expect(typeof normalizer!.fromWallTimeMs).toBe('function');
    expect(typeof normalizer!.fromPerformanceNow).toBe('function');
  });

  it('ClockNormalizer.fromWallTimeMs subtracts the wall anchor', async () => {
    const stream = new TemporalEventStream();
    const page = makeMockPage();
    await stream.attach(page);

    const normalizer = stream.getNormalizer()!;
    const wallNow = Date.now();
    const normalized = normalizer.fromWallTimeMs(wallNow + 100);
    expect(normalized).toBeGreaterThanOrEqual(99);
    expect(normalized).toBeLessThan(200);
  });

  it('ClockNormalizer.fromPerformanceNow subtracts the perf anchor', async () => {
    const stream = new TemporalEventStream();
    const page = makeMockPage();
    await stream.attach(page);

    const normalizer = stream.getNormalizer()!;
    const perfNow = performance.now();
    const normalized = normalizer.fromPerformanceNow(perfNow + 50);
    expect(normalized).toBeGreaterThanOrEqual(49);
    expect(normalized).toBeLessThan(100);
  });

  it('detach is idempotent and clears the normalizer', async () => {
    const stream = new TemporalEventStream();
    const page = makeMockPage();
    await stream.attach(page);
    expect(stream.getNormalizer()).toBeDefined();

    await stream.detach();
    expect(stream.getNormalizer()).toBeUndefined();
    await stream.detach();   // second call must not throw
  });

  it('attach is idempotent — second attach detaches first', async () => {
    const stream = new TemporalEventStream();
    const page1 = makeMockPage();
    const page2 = makeMockPage();
    await stream.attach(page1);
    const firstNormalizer = stream.getNormalizer();

    await stream.attach(page2);
    const secondNormalizer = stream.getNormalizer();
    expect(secondNormalizer).toBeDefined();
    expect(secondNormalizer).not.toBe(firstNormalizer);
  });
});
