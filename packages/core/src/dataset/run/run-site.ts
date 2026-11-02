import { mkdir } from 'node:fs/promises';
import type { Frame, Page, Route } from 'playwright';
import { join } from 'node:path';
import { createServerWithEngine } from '../../mcp/server.js';
import { DEFAULT_CAPS, RunBudget, type BudgetCaps } from '../budget.js';
import { fetchRobots, type Robots } from '../crawl/robots.js';
import { AnthropicExplorerModel, type ExplorerModel } from '../explorer/model.js';
import { Explorer, type ExplorerStopReason } from '../explorer/explorer.js';
import { Recorder } from '../recorder/recorder.js';
import { SiteMap } from '../sitemap/sitemap.js';
import { LocalClipStore, type ClipStore } from '../store/clip-store.js';
import { InProcessTools } from '../tools/in-process-tools.js';
import { TraceWriter } from '../trace/trace-writer.js';
import { regenerateReport, type RunReport } from './report.js';

export interface RunSiteOptions {
  startUrl: string; contactUrl: string; caps?: Partial<BudgetCaps>; model?: ExplorerModel; store?: ClipStore; runId?: string;
  /** Aborting stops the explorer after its current step; the run still flushes and reports. */
  signal?: AbortSignal;
}

export class ContactUrlRequired extends Error {
  constructor() { super('A contact URL is required: the crawler identifies itself with it (--contact <url>)'); }
}

const NAV_INTERVAL_MS = 2_000;
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Spec 5.1 keeps the run on the start origin. Routed on the context so popups are covered too:
 * popup pages are closed and their navigations aborted; main-frame navigations leave only for the
 * start origin's robots-allowed paths, at most one per NAV_INTERVAL_MS. Subframes and subresources pass.
 * ponytail: server redirects are not re-routed by Playwright, so a same-origin URL that 30x's
 * off-origin still lands; add a framenavigated origin check if that shows up in traces.
 */
export async function guardNavigations(page: Page, trace: TraceWriter, seed: { origin: string; robots: Robots }): Promise<void> {
  const context = page.context();
  const refuse = (detail: string) => trace.write({ type: 'tool-refused', step: 0, tool: 'navigate', detail });
  // A 204 answer keeps the current document; abort() would commit a chrome-error page instead.
  const stay = (route: Route) => route.fulfill({ status: 204 }).catch(() => undefined);
  let nextSlot = 0;
  context.on('page', (popup) => {
    if (popup === page) return;
    refuse('popup page closed');
    void popup.close().catch(() => undefined);
  });
  await context.route('**/*', async (route) => {
    const req = route.request();
    if (!req.isNavigationRequest()) return route.continue();
    let frame: Frame;
    try {
      frame = req.frame();
    } catch {
      return route.abort('blockedbyclient').catch(() => undefined); // a popup's first request precedes its frame
    }
    if (frame.page() !== page) return route.abort('blockedbyclient').catch(() => undefined);
    if (frame !== page.mainFrame()) return route.continue();
    const url = new URL(req.url());
    if (url.origin !== seed.origin) {
      refuse(`off-origin navigation ${url.origin}`);
      return stay(route);
    }
    if (!seed.robots.allowed(url.pathname + url.search)) {
      refuse(`robots.txt disallows ${req.url()}`);
      return stay(route);
    }
    const at = Math.max(Date.now(), nextSlot);
    nextSlot = at + NAV_INTERVAL_MS;
    if (at > Date.now()) await sleep(at - Date.now());
    return route.continue().catch(() => undefined);
  });
}

function stoppable(model: ExplorerModel, signal?: AbortSignal): ExplorerModel {
  if (!signal) return model;
  return {
    next: async (turn) => signal.aborted
      ? { call: { tool: 'done', args: {}, rationale: 'interrupted' }, inputTokens: 0, outputTokens: 0 }
      : model.next(turn),
  };
}

export async function runSite(opts: RunSiteOptions): Promise<{ runId: string; report: RunReport }> {
  const contactUrl = opts.contactUrl?.trim();
  if (!contactUrl) throw new ContactUrlRequired();
  const start = new URL(opts.startUrl);
  const userAgent = `UIPE-research-crawler/0.1 (+${contactUrl})`;
  const store = opts.store ?? new LocalClipStore();
  const runId = opts.runId ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${start.hostname}`;
  const runDir = store.runDir(runId);
  await mkdir(runDir, { recursive: true });
  const trace = new TraceWriter(join(runDir, 'trace.jsonl'), runId, start.hostname);
  trace.write({ type: 'run-start', step: 0 });

  const finish = async (stopReason?: string) => {
    trace.write({ type: 'run-end', step: 0, ...(stopReason ? { stopReason } : {}) });
    await trace.flush();
    return { runId, report: await regenerateReport(runDir) };
  };

  const robots = await fetchRobots(start.origin, userAgent);
  if (!robots.allowed(start.pathname + start.search)) return finish('robots-disallow');

  const { server, engine } = createServerWithEngine();
  let tools: InProcessTools | undefined;
  let stop: ExplorerStopReason = 'error';
  let finished: { runId: string; report: RunReport };
  try {
    tools = await InProcessTools.connect(server);
    await engine.ensureLaunched();
    const page = engine.runtime.getPage();
    await page.context().setExtraHTTPHeaders({ 'User-Agent': userAgent });
    await guardNavigations(page, trace, { origin: start.origin, robots });

    const siteMap = new SiteMap(start.hostname, opts.startUrl);
    const budget = new RunBudget({ ...DEFAULT_CAPS, ...opts.caps });
    const recorder = new Recorder({ engine, trace, store, siteMap, runId, site: start.hostname, budget });
    await recorder.start();
    try {
      const model = stoppable(opts.model ?? new AnthropicExplorerModel(), opts.signal);
      const explorer = new Explorer({ model, tools, recorder, siteMap, budget, trace, engine, startUrl: opts.startUrl });
      stop = (await explorer.run()).stopReason;
      if (stop === 'bot-challenge') {
        trace.write({ type: 'clip-rejected', step: 0, episodeId: 'start-page', reason: 'bot-challenge', detail: 'start page is a bot challenge; no retry' });
      }
    } finally {
      await recorder.stop();
    }
  } catch (e) {
    trace.write({ type: 'error', step: 0, message: `run: ${errMessage(e)}` });
    throw e;
  } finally {
    await tools?.close().catch(() => undefined);
    await engine.runtime.close().catch(() => undefined);
    const interrupted = opts.signal?.aborted && (stop === 'done' || stop === 'error');
    // finish() runs in finally so a thrown run still leaves a report; its result is returned below on success.
    finished = await finish(interrupted ? 'interrupted' : stop === 'bot-challenge' || stop === 'error' ? stop : undefined);
  }
  return finished;
}
