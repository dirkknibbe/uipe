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
