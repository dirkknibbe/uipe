import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { MutationCollector } from '../../../../../src/pipelines/temporal/collectors/mutation.js';
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

describe('MutationCollector', () => {
  it('attach exposes __uipeOnMutation and injects observer', async () => {
    const { page } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new MutationCollector().attach(page, stream);

    expect(page.exposeFunction).toHaveBeenCalledWith('__uipeOnMutation', expect.any(Function));
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('exposed function pushes mutation event with aggregated counts', async () => {
    const { page, exposed } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new MutationCollector().attach(page, stream);

    const onMutation = exposed.get('__uipeOnMutation');
    onMutation!({ added: 3, removed: 1, attributes: 2, characterData: 0, wallTimeMs: Date.now() });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('mutation');
    expect(events[0].payload).toEqual({ added: 3, removed: 1, attributes: 2, characterData: 0 });
  });

  it('multiple mutation batches push multiple events', async () => {
    const { page, exposed } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new MutationCollector().attach(page, stream);

    const onMutation = exposed.get('__uipeOnMutation');
    onMutation!({ added: 1, removed: 0, attributes: 0, characterData: 0, wallTimeMs: 1000 });
    onMutation!({ added: 0, removed: 0, attributes: 5, characterData: 0, wallTimeMs: 2000 });

    expect(stream.getEvents()).toHaveLength(2);
  });

  it('graceful skip if stream has no normalizer', async () => {
    const { page } = makeMockPage();
    const stream = new TemporalEventStream();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await new MutationCollector().attach(page, stream);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detach is idempotent', async () => {
    const { page } = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new MutationCollector();
    await collector.attach(page, stream);

    await collector.detach();
    await collector.detach();
  });

  it('collector has stable name', () => {
    expect(new MutationCollector().name).toBe('mutation');
  });
});
