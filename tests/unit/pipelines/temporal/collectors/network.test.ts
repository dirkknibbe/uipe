import { describe, it, expect, vi } from 'vitest';
import type { Page, CDPSession } from 'playwright';
import { NetworkCollector } from '../../../../../src/pipelines/temporal/collectors/network.js';
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

describe('NetworkCollector', () => {
  it('attach calls Network.enable and registers listeners', async () => {
    const { cdp } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new NetworkCollector();

    await collector.attach(page, stream);

    expect(cdp.send).toHaveBeenCalledWith('Network.enable');
    expect(cdp.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function));
    expect(cdp.on).toHaveBeenCalledWith('Network.responseReceived', expect.any(Function));
  });

  it('Network.requestWillBeSent pushes network-request event', async () => {
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new NetworkCollector().attach(page, stream);

    const reqHandler = handlers.get('Network.requestWillBeSent')![0];
    reqHandler({
      requestId: 'req-1',
      request: { url: 'https://api.example.com/x', method: 'POST' },
      wallTime: Date.now() / 1000,
    });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('network-request');
    expect(events[0].payload).toMatchObject({
      requestId: 'req-1',
      url: 'https://api.example.com/x',
      method: 'POST',
    });
  });

  it('Network.responseReceived pushes network-response event', async () => {
    const { cdp, handlers } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    await new NetworkCollector().attach(page, stream);

    const respHandler = handlers.get('Network.responseReceived')![0];
    respHandler({
      requestId: 'req-1',
      response: { url: 'https://api.example.com/x', status: 200 },
    });

    const events = stream.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('network-response');
    expect(events[0].payload).toMatchObject({
      requestId: 'req-1',
      url: 'https://api.example.com/x',
      status: 200,
    });
  });

  it('graceful skip if stream has no normalizer', async () => {
    const { cdp } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    // intentionally do NOT call stream.attach()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await new NetworkCollector().attach(page, stream);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detach calls cdp.detach idempotently', async () => {
    const { cdp } = makeMockCdp();
    const page = makeMockPage(cdp);
    const stream = new TemporalEventStream();
    await stream.attach(page);
    const collector = new NetworkCollector();
    await collector.attach(page, stream);

    await collector.detach();
    expect(cdp.detach).toHaveBeenCalled();
    await collector.detach();   // idempotent
  });

  it('collector has stable name', () => {
    expect(new NetworkCollector().name).toBe('network');
  });
});
