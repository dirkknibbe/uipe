import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { InputCollector } from '../../../../../src/pipelines/temporal/collectors/input.js';
import { TemporalEventStream } from '../../../../../src/pipelines/temporal/event-stream.js';

const makeMockPage = () => {
  const exposed = new Map<string, Function>();
  return {
    page: {
      evaluate: vi.fn(async () => 0),
      exposeFunction: vi.fn(async (name: string, fn: Function) => { exposed.set(name, fn); }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page,
    exposed,
  };
};

describe('InputCollector', () => {
  it('attach exposes __uipeOnInput and injects listener script', async () => {
    const { page } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new InputCollector();

    await collector.attach(page, stream);

    expect(page.exposeFunction).toHaveBeenCalledWith('__uipeOnInput', expect.any(Function));
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('exposed function pushes click input event', async () => {
    const { page, exposed } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new InputCollector();
    await collector.attach(page, stream);

    const onInput = exposed.get('__uipeOnInput');
    expect(onInput).toBeDefined();
    onInput!({ kind: 'click', x: 100, y: 200, target: 'button.submit', wallTimeMs: Date.now() });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('input');
    expect(events[0].payload).toMatchObject({ kind: 'click', position: { x: 100, y: 200 }, target: 'button.submit' });
    expect(events[0].timestamp).toBeGreaterThanOrEqual(0);
  });

  it('exposed function pushes keydown input event', async () => {
    const { page, exposed } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new InputCollector();
    await collector.attach(page, stream);

    const onInput = exposed.get('__uipeOnInput');
    onInput!({ kind: 'keydown', key: 'Enter', wallTimeMs: Date.now() });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ kind: 'keydown', key: 'Enter' });
  });

  it('detach is idempotent', async () => {
    const { page } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new InputCollector();
    await collector.attach(page, stream);

    await collector.detach();
    await collector.detach();   // second call must not throw
  });

  it('collector has stable name', () => {
    expect(new InputCollector().name).toBe('input');
  });
});
