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
  on: vi.fn(),
  off: vi.fn(),
  evaluate: vi.fn(async () => 0),
  context: vi.fn(() => ({ newCDPSession: vi.fn(async () => cdp) })),
}) as unknown as Page;

const makeMockCdpWithVerifier = (opts: {
  resolveResponse?: any;
  startReadResponse?: any;
  endReadResponse?: any;
  resolveThrows?: boolean;
} = {}) => {
  const handlers = new Map<string, Function[]>();
  let readCallCount = 0;
  const cdp = {
    send: vi.fn(async (method: string) => {
      if (method === 'Animation.enable') return undefined;
      if (method === 'Animation.resolveAnimation') {
        if (opts.resolveThrows) throw new Error('gone');
        return opts.resolveResponse ?? { remoteObject: { objectId: 'obj-1' } };
      }
      if (method === 'Runtime.callFunctionOn') {
        readCallCount++;
        if (readCallCount === 1) {
          return opts.startReadResponse ?? {
            result: {
              value: {
                keyframes: [
                  { offset: 0, transform: 'translateX(0px)' },
                  { offset: 1, transform: 'translateX(240px)' },
                ],
                timing: { iterations: 1, direction: 'normal' },
                bbox: { x: 10, y: 20, w: 100, h: 50 },
              },
            },
          };
        }
        return opts.endReadResponse ?? { result: { value: { translateX: 240 } } };
      }
      return undefined;
    }),
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
        startTime: performance.now(),
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

  it('stamps animation-start from CDP startTime in page-clock milliseconds', async () => {
    // CDP Animation.startTime is milliseconds on the page's performance clock (verified in Chromium).
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    (page.evaluate as any).mockResolvedValue(1000); // page performance.now() at attach
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    handlers.get('Animation.animationStarted')![0]({
      animation: { id: 'anim-ms', name: 'rise', startTime: 1250, playbackRate: 1, source: { duration: 300 } },
    });

    expect(stream.getEvents()[0].timestamp).toBe(250);
  });

  it('keeps identical CDP starts from one stagger (same name, start time and delay)', async () => {
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);
    const fire = handlers.get('Animation.animationStarted')![0];
    for (const id of ['r1', 'r2']) {
      fire({ animation: { id, name: 'reveal', startTime: 500, playbackRate: 1, source: { duration: 40, delay: 0 } } });
    }
    expect(stream.getEvents().filter((e) => e.type === 'animation-start')).toHaveLength(2);
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

  it('still ends an animation that was running when the stream re-attached it on navigation', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, handlers } = makeMockCdp();
      const page = makeMockPage(cdp);
      const stream = new TemporalEventStream();
      await stream.attach(page);
      const collector = new AnimationCollector();
      await collector.attach(page, stream);
      await handlers.get('Animation.animationStarted')![0]({
        animation: { id: 'anim-r', name: 'rise', startTime: 0, playbackRate: 1, source: { duration: 300, iterations: 1 } },
      });

      await collector.detach();
      await collector.attach(page, stream);
      await vi.advanceTimersByTimeAsync(400);

      const end = stream.getEvents().find((e) => e.type === 'animation-end');
      expect(end?.payload).toMatchObject({ animationId: 'anim-r', reason: 'completed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the end of an animation whose document died when the stream re-anchored its clock', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, handlers } = makeMockCdp();
      const page = makeMockPage(cdp);
      const stream = new TemporalEventStream();
      await stream.attach(page);
      const collector = new AnimationCollector();
      await collector.attach(page, stream);
      await handlers.get('Animation.animationStarted')![0]({
        animation: { id: 'hover-u', name: 'underline', startTime: 0, playbackRate: 1, source: { duration: 250, iterations: 1 } },
      });

      // Cross-document navigation: new clock, and the new session never replays 'hover-u'.
      await stream.attach(page);
      await collector.detach();
      await collector.attach(page, stream);
      await vi.advanceTimersByTimeAsync(400);

      expect(stream.getEvents().filter((e) => e.type === 'animation-end')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-stamps on the new clock the end of an animation the new session replayed after a re-anchor', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, handlers } = makeMockCdp();
      const page = makeMockPage(cdp);
      const stream = new TemporalEventStream();
      await stream.attach(page);
      const collector = new AnimationCollector();
      await collector.attach(page, stream);
      const start = { animation: { id: 'spa-r', name: 'rise', startTime: 0, playbackRate: 1, source: { duration: 300, iterations: 1 } } };
      await handlers.get('Animation.animationStarted')![0](start);
      const wallAtStart = Date.now();

      await vi.advanceTimersByTimeAsync(100);
      // Same-document navigation: the clock re-anchors, but the animation survives and is replayed.
      await stream.attach(page);
      await collector.detach();
      await collector.attach(page, stream);
      const replay = handlers.get('Animation.animationStarted')!;
      await replay[replay.length - 1](start);
      await vi.advanceTimersByTimeAsync(300);

      const ends = stream.getEvents().filter((e) => e.type === 'animation-end');
      expect(ends).toHaveLength(1);
      expect(ends[0].payload).toMatchObject({ animationId: 'spa-r', reason: 'completed' });
      expect(ends[0].timestamp).toBeCloseTo(stream.getNormalizer()!.fromWallTimeMs(wallAtStart + 300), 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listens before Animation.enable, which replays existing animations before its reply', async () => {
    const { cdp, handlers } = makeMockCdp();
    (cdp.send as any).mockImplementation(async (method: string) => {
      if (method !== 'Animation.enable') return undefined;
      // Chromium replays existing animations as animationStarted before the enable reply.
      for (const h of handlers.get('Animation.animationStarted') ?? []) {
        h({ animation: { id: 'early', name: 'slide-up', startTime: 5, playbackRate: 1, source: { duration: 400 } } });
      }
      return undefined;
    });
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);
    expect(stream.getEvents().filter((e) => e.type === 'animation-start').map((e) => (e.payload as any).name)).toEqual(['slide-up']);
  });

  it('does not push again a start the previous session reported when Animation.enable replays it', async () => {
    const { cdp, handlers } = makeMockCdpWithVerifier({
      startReadResponse: { result: { value: { keyframes: [], timing: {}, bbox: null, tag: 'h1', marker: 'r1' } } },
    });
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new AnimationCollector();
    await collector.attach(page, stream);
    const start = { animation: { id: 'r1', name: 'rise', startTime: 120, playbackRate: 1, source: { duration: 500 } } };
    (cdp.send as any).mockImplementationOnce(async () => { throw new Error('session closed'); }); // old session dies mid-read
    await handlers.get('Animation.animationStarted')![0](start);

    await collector.detach();
    await collector.attach(page, stream);
    const replayHandlers = handlers.get('Animation.animationStarted')!;
    await replayHandlers[replayHandlers.length - 1](start);

    const starts = stream.getEvents().filter((e) => e.type === 'animation-start');
    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toMatchObject({ animationId: 'r1', targetMarker: 'r1', targetTag: 'h1' });
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
    // Handler is async (awaits captureStart); await it so the setTimeout is registered.
    await handler({
      animation: {
        id: 'anim-2',
        name: 'fade',
        startTime: performance.now(),
        playbackRate: 1,
        source: { duration: 300, iterations: 1, easing: 'linear' },
      },
    });

    // animation-start is pushed synchronously; animation-prediction follows via
    // captureStart (skipped — makeMockCdp returns undefined for resolveAnimation,
    // so the verifier returns a skipped payload but still pushes the event).
    const eventsAfterStart = stream.getEvents();
    expect(eventsAfterStart[0].type).toBe('animation-start');

    await vi.advanceTimersByTimeAsync(317);
    const events = stream.getEvents();
    const endEvent = events.find((e) => e.type === 'animation-end');
    expect(endEvent).toBeDefined();
    expect(endEvent!.payload).toMatchObject({ animationId: 'anim-2', reason: 'completed' });
    vi.useRealTimers();
  });

  it('animationStarted pushes animation-prediction after animation-start', async () => {
    const { cdp, handlers } = makeMockCdpWithVerifier();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const handler = handlers.get('Animation.animationStarted')![0];
    await handler({
      animation: {
        id: 'anim-1',
        name: 'slide',
        startTime: performance.now(),
        playbackRate: 1,
        source: { duration: 300, easing: 'linear' },
      },
    });

    // Allow promises queued in the handler to resolve.
    await new Promise((r) => setImmediate(r));

    const events = stream.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('animation-start');
    expect(events[1].type).toBe('animation-prediction');
    expect((events[1].payload as any).animationId).toBe('anim-1');
    expect((events[1].payload as any).predicted).toEqual([
      { property: 'translateX', endValue: 240, unit: 'px' },
    ]);
  });

  it('animation-end carries deviation when prediction + observation succeed', async () => {
    vi.useFakeTimers();
    try {
      const { cdp, handlers } = makeMockCdpWithVerifier();
      const page = makeMockPage(cdp);
      const stream = new TemporalEventStream();
      await stream.attach(page);
      await new AnimationCollector().attach(page, stream);

      const handler = handlers.get('Animation.animationStarted')![0];
      await handler({
        animation: {
          id: 'anim-1',
          name: 'slide',
          startTime: performance.now(),
          playbackRate: 1,
          source: { duration: 100, iterations: 1, easing: 'linear' },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120);
      await vi.advanceTimersByTimeAsync(0);

      const events = stream.getEvents();
      const endEvent = events.find((e) => e.type === 'animation-end');
      expect(endEvent).toBeDefined();
      const payload = endEvent!.payload as any;
      expect(payload.reason).toBe('completed');
      expect(payload.deviation).toBeDefined();
      expect(payload.deviation.score).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('animationCanceled drops pending verifier state', async () => {
    const { cdp, handlers } = makeMockCdpWithVerifier();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new AnimationCollector();
    await collector.attach(page, stream);

    const startHandler = handlers.get('Animation.animationStarted')![0];
    await startHandler({
      animation: {
        id: 'anim-1',
        name: 'slide',
        startTime: performance.now(),
        playbackRate: 1,
        source: { duration: 300, easing: 'linear' },
      },
    });
    await new Promise((r) => setImmediate(r));

    const cancelHandler = handlers.get('Animation.animationCanceled')![0];
    cancelHandler({ id: 'anim-1' });

    const events = stream.getEvents();
    const endEvent = events.find((e) => e.type === 'animation-end');
    expect(endEvent).toBeDefined();
    expect((endEvent!.payload as any).reason).toBe('canceled');
    expect((endEvent!.payload as any).deviation).toBeUndefined();
  });

  it('detach clears pending verifier state', async () => {
    const { cdp, handlers } = makeMockCdpWithVerifier();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new AnimationCollector();
    await collector.attach(page, stream);

    const startHandler = handlers.get('Animation.animationStarted')![0];
    await startHandler({
      animation: {
        id: 'anim-1',
        name: 'slide',
        startTime: performance.now(),
        playbackRate: 1,
        source: { duration: 300, easing: 'linear' },
      },
    });
    await new Promise((r) => setImmediate(r));

    await collector.detach();
    // Re-attaching does not surface leaked events; detach should not throw.
    expect(cdp.detach).toHaveBeenCalled();
  });

  it('suppresses prediction event when cancel arrives during captureStart roundtrip', async () => {
    // Race: animationStarted handler awaits captureStart, but animationCanceled
    // fires before captureStart resolves. The terminal animation-end has
    // already landed — emitting animation-prediction after it would violate
    // the timeline's "end is terminal" invariant.
    const handlers = new Map<string, Function[]>();
    let resolveStartRead: (value: unknown) => void = () => {};
    const startReadPromise = new Promise((resolve) => { resolveStartRead = resolve; });
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Animation.enable') return undefined;
        if (method === 'Animation.resolveAnimation') return { remoteObject: { objectId: 'obj-1' } };
        if (method === 'Runtime.callFunctionOn') return startReadPromise; // hangs until we resolve
        return undefined;
      }),
      on: vi.fn((event: string, handler: Function) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      off: vi.fn(),
      detach: vi.fn(),
    } as unknown as CDPSession;
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new AnimationCollector().attach(page, stream);

    const startHandler = handlers.get('Animation.animationStarted')![0];
    // Fire-and-don't-await the started handler — it will hang on the read.
    const inflight = startHandler({
      animation: {
        id: 'anim-1',
        name: 'slide',
        startTime: performance.now(),
        playbackRate: 1,
        source: { duration: 300, easing: 'linear' },
      },
    });

    // Let the synchronous animation-start push happen.
    await new Promise((r) => setImmediate(r));

    // Cancel arrives while captureStart is still awaiting.
    const cancelHandler = handlers.get('Animation.animationCanceled')![0];
    cancelHandler({ id: 'anim-1' });

    // Now resolve the read so captureStart returns its payload.
    resolveStartRead({
      result: {
        value: {
          keyframes: [
            { offset: 0, transform: 'translateX(0px)' },
            { offset: 1, transform: 'translateX(240px)' },
          ],
          timing: { iterations: 1, direction: 'normal' },
          bbox: { x: 0, y: 0, w: 10, h: 10 },
        },
      },
    });
    await inflight;
    await new Promise((r) => setImmediate(r));

    const events = stream.getEvents();
    const types = events.map((e) => e.type);
    // Order: animation-start, then animation-end (canceled). NO animation-prediction.
    expect(types).toEqual(['animation-start', 'animation-end']);
    expect((events[1].payload as any).reason).toBe('canceled');
  });
});

describe('AnimationCollector timing and target marker', () => {
  const setup = async (cdp: CDPSession) => {
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new AnimationCollector();
    await collector.attach(page, stream);
    return { stream, collector };
  };
  const startAnim = (handlers: Map<string, Function[]>, id: string, source: object) =>
    handlers.get('Animation.animationStarted')![0]({
      animation: { id, name: 'x', startTime: performance.now(), playbackRate: 1, source },
    });
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });

  it('emits_end_after_all_iterations', async () => {
    fake();
    try {
      const { cdp, handlers } = makeMockCdp();
      const { stream } = await setup(cdp);
      await startAnim(handlers, 'a', { duration: 200, iterations: 3, delay: 100, endDelay: 0 });
      await vi.advanceTimersByTimeAsync(300);
      expect(stream.getEvents().some((e) => e.type === 'animation-end')).toBe(false);
      await vi.advanceTimersByTimeAsync(420);
      const end = stream.getEvents().find((e) => e.type === 'animation-end')!;
      expect(end.payload).toMatchObject({ animationId: 'a', reason: 'completed' });
      const start = stream.getEvents().find((e) => e.type === 'animation-start')!;
      expect(end.timestamp - start.timestamp).toBe(700);
    } finally { vi.useRealTimers(); }
  });

  it('infinite_animation_never_emits_completed_end', async () => {
    fake();
    try {
      const { cdp, handlers } = makeMockCdp();
      const { stream } = await setup(cdp);
      await startAnim(handlers, 'inf', { duration: 200 });
      await vi.advanceTimersByTimeAsync(5000);
      const events = stream.getEvents();
      expect(events.find((e) => e.type === 'animation-start')!.payload).toMatchObject({ iterations: Infinity });
      expect(events.some((e) => e.type === 'animation-end')).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('zero_duration_does_not_leak_active_entry', async () => {
    const { cdp, handlers } = makeMockCdp();
    const { collector } = await setup(cdp);
    await startAnim(handlers, 'z', { duration: 0, iterations: 1 });
    expect((collector as any).active.size).toBe(0);
  });

  it('start_payload_carries_target_marker_and_selector', async () => {
    const { cdp, handlers } = makeMockCdpWithVerifier({
      startReadResponse: { result: { value: { selector: 'div.modal', tag: 'div', marker: 'anim-1' } } },
    });
    const { stream } = await setup(cdp);
    await startAnim(handlers, 'anim-1', { duration: 300, iterations: 1 });
    const start = stream.getEvents().find((e) => e.type === 'animation-start')!;
    expect(start.payload).toMatchObject({ target: 'div.modal', targetTag: 'div', targetMarker: 'anim-1' });
  });
});
