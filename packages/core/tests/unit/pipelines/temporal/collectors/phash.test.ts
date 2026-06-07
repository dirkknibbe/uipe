import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import { PHashCollector, type PHashEmitter } from '../../../../../src/pipelines/temporal/collectors/phash.js';
import { TemporalEventStream } from '../../../../../src/pipelines/temporal/event-stream.js';

const makeMockPage = () => ({
  evaluate: vi.fn(async () => 0),
  exposeFunction: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}) as unknown as Page;

class TestEmitter implements PHashEmitter {
  private callback: ((diff: any) => void) | undefined;
  onPHashChange(cb: (diff: any) => void): void { this.callback = cb; }
  offPHashChange(cb: (diff: any) => void): void { if (this.callback === cb) this.callback = undefined; }
  emit(diff: any) { this.callback?.(diff); }
}

describe('PHashCollector', () => {
  it('attach subscribes to emitter and detach unsubscribes', async () => {
    const page = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const emitter = new TestEmitter();
    const onSpy = vi.spyOn(emitter, 'onPHashChange');
    const offSpy = vi.spyOn(emitter, 'offPHashChange');

    const collector = new PHashCollector(emitter);
    await collector.attach(page, stream);
    expect(onSpy).toHaveBeenCalled();

    await collector.detach();
    expect(offSpy).toHaveBeenCalled();
  });

  it('emitter diff pushes phash-change event', async () => {
    const page = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const emitter = new TestEmitter();
    await new PHashCollector(emitter).attach(page, stream);

    emitter.emit({
      region: { x: 10, y: 20, width: 100, height: 50 },
      hammingDistance: 7,
    });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('phash-change');
    expect(events[0].payload).toEqual({
      region: { x: 10, y: 20, width: 100, height: 50 },
      hammingDistance: 7,
    });
  });

  it('graceful skip if no emitter provided', async () => {
    const page = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await new PHashCollector(undefined).attach(page, stream);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detach is idempotent', async () => {
    const page = makeMockPage();
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new PHashCollector(new TestEmitter());
    await collector.attach(page, stream);
    await collector.detach();
    await collector.detach();
  });

  it('collector has stable name', () => {
    expect(new PHashCollector(new TestEmitter()).name).toBe('phash');
  });
});
