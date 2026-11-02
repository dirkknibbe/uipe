import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalClipStore } from '../../../../src/dataset/store/clip-store.js';

const h = vi.hoisted(() => ({
  explorerRun: vi.fn(),
  robotsAllowed: true,
  close: vi.fn(async () => undefined),
  setHeaders: vi.fn(async () => undefined),
  recorderStop: vi.fn(async () => ({ kept: 0, rejected: 0, duplicates: 0 })),
  launches: 0,
}));

vi.mock('../../../../src/mcp/server.js', () => ({
  createServerWithEngine: () => ({
    server: {},
    engine: {
      ensureLaunched: async () => { h.launches++; },
      runtime: { close: h.close, getPage: () => ({ on: vi.fn(), mainFrame: vi.fn(), context: () => ({ setExtraHTTPHeaders: h.setHeaders, route: vi.fn(async () => undefined), on: vi.fn() }) }) },
    },
  }),
}));
vi.mock('../../../../src/dataset/tools/in-process-tools.js', () => ({ InProcessTools: { connect: async () => ({ close: async () => undefined }) } }));
vi.mock('../../../../src/dataset/recorder/recorder.js', () => ({ Recorder: class { start = async () => undefined; stop = h.recorderStop; } }));
vi.mock('../../../../src/dataset/explorer/explorer.js', () => ({ Explorer: class { run = h.explorerRun; } }));
vi.mock('../../../../src/dataset/crawl/robots.js', () => ({
  fetchRobots: async () => ({ status: 'ok', allowed: () => h.robotsAllowed }),
}));

import { runSite, ContactUrlRequired, guardNavigations, canonicalStartOrigin } from '../../../../src/dataset/run/run-site.js';

const model = { next: vi.fn() };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'runsite-'));
  return { store: new LocalClipStore(root), root };
}

beforeEach(() => {
  h.robotsAllowed = true; h.launches = 0;
  h.explorerRun.mockReset().mockResolvedValue({ stopReason: 'done' });
  h.close.mockClear(); h.setHeaders.mockClear();
});

describe('runSite', () => {
  it('refuses_to_run_without_contact_url', async () => {
    const { store } = await setup();
    await expect(runSite({ startUrl: 'https://a.test/', contactUrl: '  ', model, store })).rejects.toThrow(ContactUrlRequired);
    expect(h.launches).toBe(0);
  });

  it('robots_disallow_ends_run_without_launching_browser', async () => {
    h.robotsAllowed = false;
    const { store } = await setup();
    const { runId, report } = await runSite({ startUrl: 'https://a.test/x', contactUrl: 'https://me.test', model, store });
    expect(h.launches).toBe(0);
    expect(report.stopReason).toBe('robots-disallow');
    expect(await readFile(join(store.runDir(runId), 'trace.jsonl'), 'utf8')).toContain('"stopReason":"robots-disallow"');
  });

  it('sets_crawler_user_agent_with_contact_url', async () => {
    const { store } = await setup();
    await runSite({ startUrl: 'https://a.test/', contactUrl: 'https://me.test', model, store });
    expect(h.setHeaders).toHaveBeenCalledWith({ 'User-Agent': 'UIPE-research-crawler/0.1 (+https://me.test)' });
  });

  it('stops_site_on_bot_challenge_without_retry', async () => {
    h.explorerRun.mockResolvedValue({ stopReason: 'bot-challenge' });
    const { store } = await setup();
    const { runId, report } = await runSite({ startUrl: 'https://a.test/', contactUrl: 'https://me.test', model, store });
    expect(h.explorerRun).toHaveBeenCalledTimes(1);
    const trace = (await readFile(join(store.runDir(runId), 'trace.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(trace.filter((r) => r.type === 'clip-rejected')).toHaveLength(1);
    expect(trace.find((r) => r.type === 'clip-rejected').reason).toBe('bot-challenge');
    expect(report.stopReason).toBe('bot-challenge');
  });

  it('browser_closed_even_when_explorer_throws', async () => {
    h.explorerRun.mockRejectedValue(new Error('kaboom'));
    const { store } = await setup();
    await expect(runSite({ startUrl: 'https://a.test/', contactUrl: 'https://me.test', model, store })).rejects.toThrow('kaboom');
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.recorderStop).toHaveBeenCalled();
  });
});

describe('canonicalStartOrigin', () => {
  it('keeps_the_origin_when_the_start_page_lands_where_it_started', () => {
    expect(canonicalStartOrigin('https://a.test', 'https://a.test/home')).toBe('https://a.test');
  });
  it('adopts_a_www_or_apex_landing_on_the_same_site', () => {
    expect(canonicalStartOrigin('https://a.test', 'https://www.a.test/')).toBe('https://www.a.test');
    expect(canonicalStartOrigin('https://www.a.test', 'https://a.test/x')).toBe('https://a.test');
  });
  it('rejects_another_site_scheme_port_or_subdomain', () => {
    expect(canonicalStartOrigin('https://a.test', 'https://b.test/')).toBeNull();
    expect(canonicalStartOrigin('https://a.test', 'http://www.a.test/')).toBeNull();
    expect(canonicalStartOrigin('https://a.test', 'https://a.test:8443/')).toBeNull();
    expect(canonicalStartOrigin('https://a.test', 'https://shop.a.test/')).toBeNull();
    expect(canonicalStartOrigin('https://a.test', 'https://www.www.a.test/')).toBeNull();
  });
});

describe('guardNavigations', () => {
  async function harness() {
    let handler: any;
    let onPage: any;
    const main: any = {};
    const page: any = { mainFrame: () => main, on: () => undefined };
    page.context = () => ({ route: async (_: string, h: any) => { handler = h; }, on: (_: string, h: any) => { onPage = h; } });
    main.page = () => page;
    const written: any[] = [];
    const trace: any = { write: (r: any) => written.push(r) };
    await guardNavigations(page, trace, { origin: 'https://a.test', robots: { status: 'ok', allowed: (p: string) => !p.startsWith('/private') } });
    const nav = async (url: string, frame: any = main) => {
      const route = { request: () => ({ isNavigationRequest: () => true, frame: () => (frame === 'none' ? (() => { throw new Error('no frame'); })() : frame), url: () => url }), continue: vi.fn(async () => undefined), abort: vi.fn(async () => undefined), fulfill: vi.fn(async () => undefined) };
      await handler(route);
      return route;
    };
    return { nav, written, page, popup: (p: any) => onPage(p) };
  }

  it('aborts_later_same_origin_navigation_into_disallowed_path_and_traces_it', async () => {
    const { nav, written } = await harness();
    const r = await nav('https://a.test/private/x');
    expect(r.fulfill).toHaveBeenCalledWith({ status: 204 }); expect(r.continue).not.toHaveBeenCalled();
    expect(written[0]).toMatchObject({ type: 'tool-refused', tool: 'navigate' });
  });

  it('allows_same_origin_navigation', async () => {
    const { nav } = await harness();
    expect((await nav('https://a.test/ok')).continue).toHaveBeenCalled();
  });

  it('aborts_off_origin_main_frame_navigation_and_traces_it', async () => {
    const { nav, written } = await harness();
    const r = await nav('https://b.test/');
    expect(r.fulfill).toHaveBeenCalledWith({ status: 204 }); expect(r.continue).not.toHaveBeenCalled();
    expect(written[0]).toMatchObject({ type: 'tool-refused', detail: 'off-origin navigation https://b.test' });
  });

  it('closes_popup_pages_and_aborts_their_navigations', async () => {
    const { nav, popup, written } = await harness();
    const other: any = { close: vi.fn(async () => undefined) };
    const popupFrame = { page: () => other };
    expect((await nav('https://a.test/ok', popupFrame)).abort).toHaveBeenCalled();
    expect((await nav('https://a.test/ok', 'none')).abort).toHaveBeenCalled();
    popup(other);
    expect(other.close).toHaveBeenCalled();
    expect(written.at(-1)).toMatchObject({ type: 'tool-refused', detail: 'popup page closed' });
  });

  it('subframe_navigations_skip_the_check', async () => {
    const { nav, page } = await harness();
    expect((await nav('https://b.test/no', { page: () => page })).continue).toHaveBeenCalled();
  });
});
