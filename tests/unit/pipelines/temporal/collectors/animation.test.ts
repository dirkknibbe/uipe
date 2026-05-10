import { describe, it, expect, vi } from 'vitest';
import type { Page, CDPSession } from 'playwright';
import { AnimationCollector } from '../../../../../src/pipelines/temporal/collectors/animation.js';
import { TemporalEventStream } from '../../../../../src/pipelines/temporal/event-stream.js';

const makeMockCdp = () => {
  const handlers = new Map<string, Function[]>();
  const cdp = {
    send: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: vi.fn(),
    detach: vi.fn(),
  } as unknown as CDPSession;
  return { cdp, handlers };
};

const makeMockPage = (cdp: CDPSession) => ({
  evaluate: vi.fn(async () => 0),
  context: vi.fn(() => ({ newCDPSession: vi.fn(async () => cdp) })),
}) as unknown as Page;

describe('AnimationCollector', () => {
  it('attach calls Animation.enable and registers listeners', async () => {
    const { cdp } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    expect(cdp.send).toHaveBeenCalledWith('Animation.enable');
    expect(cdp.on).toHaveBeenCalledWith('Animation.animationStarted', expect.any(Function));
    expect(cdp.on).toHaveBeenCalledWith('Animation.animationCanceled', expect.any(Function));
  });

  it('animationStarted pushes animation-start event', async () => {
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const handler = handlers.get('Animation.animationStarted')![0];
    handler({
      animation: {
        id: 'anim-1',
        name: 'slide-in',
        startTime: performance.now() / 1000,
        playbackRate: 1,
        source: { duration: 300, easing: 'ease-out' },
      },
    });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('animation-start');
    expect(events[0].payload).toMatchObject({
      animationId: 'anim-1',
      name: 'slide-in',
      duration: 300,
      easing: 'ease-out',
    });
  });

  it('animationCanceled pushes animation-end event with reason canceled', async () => {
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const handler = handlers.get('Animation.animationCanceled')![0];
    handler({ id: 'anim-1' });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('animation-end');
    expect(events[0].payload).toMatchObject({ animationId: 'anim-1', reason: 'canceled' });
  });

  it('graceful skip if Animation.enable fails', async () => {
    const { cdp } = makeMockCdp();
    (cdp.send as any).mockRejectedValueOnce(new Error('domain unavailable'));
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await new AnimationCollector().attach(page, stream);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detach is idempotent', async () => {
    const { cdp } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new AnimationCollector();
    await collector.attach(page, stream);

    await collector.detach();
    await collector.detach();
  });

  it('collector has stable name', () => {
    expect(new AnimationCollector().name).toBe('animation');
  });

  it('animationStarted with duration synthesizes a completed animation-end after duration', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const handler = handlers.get('Animation.animationStarted')![0];
    handler({
      animation: {
        id: 'anim-2',
        name: 'fade',
        startTime: performance.now() / 1000,
        playbackRate: 1,
        source: { duration: 300, easing: 'linear' },
      },
    });

    expect(stream.size()).toBe(1);

    vi.advanceTimersByTime(317);
    expect(stream.size()).toBe(2);
    const events = stream.getEvents();
    expect(events[1].type).toBe('animation-end');
    expect(events[1].payload).toMatchObject({ animationId: 'anim-2', reason: 'completed' });
    vi.useRealTimers();
  });
});
