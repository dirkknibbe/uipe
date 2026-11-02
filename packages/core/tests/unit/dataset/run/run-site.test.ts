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
      runtime: { close: h.close, getPage: () => ({ route: vi.fn(async () => undefined), context: () => ({ setExtraHTTPHeaders: h.setHeaders }) }) },
    },
  }),
}));
vi.mock('../../../../src/dataset/tools/in-process-tools.js', () => ({ InProcessTools: { connect: async () => ({ close: async () => undefined }) } }));
vi.mock('../../../../src/dataset/recorder/recorder.js', () => ({ Recorder: class { start = async () => undefined; stop = h.recorderStop; } }));
vi.mock('../../../../src/dataset/explorer/explorer.js', () => ({ Explorer: class { run = h.explorerRun; } }));
vi.mock('../../../../src/dataset/crawl/robots.js', () => ({
  fetchRobots: async () => ({ status: 'ok', allowed: () => h.robotsAllowed }),
}));

import { runSite, ContactUrlRequired, guardNavigations } from '../../../../src/dataset/run/run-site.js';

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

describe('guardNavigations', () => {
  async function harness(fetchRobotsImpl: any) {
    let handler: any;
    const main = {};
    const page: any = { route: async (_: string, h: any) => { handler = h; }, mainFrame: () => main };
    const written: any[] = [];
    const trace: any = { write: (r: any) => written.push(r) };
    await guardNavigations(page, 'ua', trace, { origin: 'https://a.test', robots: { status: 'ok', allowed: (p: string) => !p.startsWith('/private') } }, fetchRobotsImpl);
    const nav = async (url: string, frame: any = main) => {
      const route = { request: () => ({ isNavigationRequest: () => true, frame: () => frame, url: () => url }), continue: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) };
      await handler(route);
      return route;
    };
    return { nav, written };
  }

  it('aborts_later_same_origin_navigation_into_disallowed_path_and_traces_it', async () => {
    const { nav, written } = await harness(vi.fn());
    const r = await nav('https://a.test/private/x');
    expect(r.abort).toHaveBeenCalled(); expect(r.continue).not.toHaveBeenCalled();
    expect(written[0]).toMatchObject({ type: 'tool-refused', tool: 'navigate' });
  });

  it('checks_robots_per_cross_origin_and_caches_it', async () => {
    const f = vi.fn(async () => ({ status: 'ok', allowed: (p: string) => p !== '/no' }));
    const { nav } = await harness(f);
    expect((await nav('https://b.test/no')).abort).toHaveBeenCalled();
    expect((await nav('https://b.test/ok')).continue).toHaveBeenCalled();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('subframe_navigations_skip_the_check', async () => {
    const f = vi.fn();
    const { nav } = await harness(f);
    expect((await nav('https://b.test/no', {})).continue).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});
