import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, type FixtureServer } from '../../e2e/fixture-server.js';
import { runSite } from '../../../src/dataset/run/run-site.js';
import type { RunReport } from '../../../src/dataset/run/report.js';
import type { ExplorerCall, ExplorerModel } from '../../../src/dataset/explorer/model.js';
import { LocalClipStore } from '../../../src/dataset/store/clip-store.js';
import { readTrace } from '../../../src/dataset/trace/trace-writer.js';
import type { TraceRecord } from '../../../src/dataset/trace/trace-types.js';
import type { Clip } from '../../../src/dataset/types.js';

// The component indexer's idle drain would call the Anthropic API; external services stay mocked.
vi.mock('../../../src/pipelines/component-index/vlm-classifier.js', () => ({ classifyByVlm: async () => 'Unknown' }));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CONTACT = 'https://example.test/uipe-contact';
// Fixture geometry (site.css): first nav link centre, an inert right margin, the modal button.
const NAV_HOME = { x: 84, y: 32 };
const INERT = { x: 1240, y: 400 };
const MODAL_BUTTON = { x: 290, y: 452 };
const SITE_RUN_TIMEOUT_MS = 600_000;

const call = (tool: ExplorerCall['tool'], args: Record<string, unknown> = {}): ExplorerCall => ({ tool, args, rationale: 'scripted' });

/** Plays a fixed script, then calls done; never touches the network. */
function scriptedModel(calls: ExplorerCall[]): ExplorerModel {
  let i = 0;
  return { next: async () => ({ call: calls[i++] ?? call('done'), inputTokens: 0, outputTokens: 0 }) };
}

function siteScript(base: string): ExplorerCall[] {
  const hoverNav = [call('act', { type: 'hover', ...NAV_HOME, target: 'Home' }), call('act', { type: 'hover', ...INERT })];
  return [
    ...hoverNav,
    call('act', { type: 'click', ...MODAL_BUTTON, target: 'Open details' }),
    ...['about', 'gallery', 'pricing'].flatMap((p) => [call('navigate', { url: `${base}/${p}.html` }), ...hoverNav]),
  ];
}

interface RunOutcome { runId: string; report: RunReport; clips: Clip[]; trace: TraceRecord[]; wallMs: number }

let server: FixtureServer;
let root: string;
const savedDatasetDir = process.env.UIPE_DATASET_DIR;

async function run(page: string, model: ExplorerModel, caps?: { maxWallMs: number }): Promise<RunOutcome> {
  const store = new LocalClipStore();
  const startedAt = Date.now();
  const { runId, report } = await runSite({ startUrl: `${server.baseUrl}/${page}`, contactUrl: CONTACT, model, ...(caps ? { caps } : {}) });
  return {
    runId, report, wallMs: Date.now() - startedAt,
    clips: await store.listClips(runId),
    trace: await readTrace(join(store.runDir(runId), 'trace.jsonl')),
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'uipe-dataset-e2e-'));
  process.env.UIPE_DATASET_DIR = root;
  server = await startFixtureServer(FIXTURES);
});

afterAll(async () => {
  await server?.close();
  if (savedDatasetDir === undefined) delete process.env.UIPE_DATASET_DIR;
  else process.env.UIPE_DATASET_DIR = savedDatasetDir;
  await rm(root, { recursive: true, force: true });
});

describe('dataset run against the animated fixture site', () => {
  let site: RunOutcome;

  beforeAll(async () => {
    site = await run('index.html', scriptedModel(siteScript(server.baseUrl)));
  }, SITE_RUN_TIMEOUT_MS);

  it('e2e_keeps_expected_episodes_and_rejects_junk_with_reasons', () => {
    const kinds = new Set(site.clips.map((c) => c.kind));
    for (const kind of ['page-load', 'modal', 'scroll', 'loop']) expect(kinds, `kept kinds ${[...kinds]}`).toContain(kind);
    expect(site.clips.some((c) => c.kind === 'modal' && c.episode.animations.length >= 5)).toBe(true);

    const reasons = new Set(site.trace.flatMap((r) => (r.type === 'clip-rejected' ? [r.reason] : [])));
    for (const reason of ['cookie-consent', 'spinner', 'offscreen', 'media-playback'] as const) {
      expect(reasons, `rejected reasons ${[...reasons]}`).toContain(reason);
    }

    const hovers = site.clips.filter((c) => c.episode.trigger.action?.type === 'hover');
    expect(hovers).toHaveLength(1);
    expect(hovers[0].occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it('e2e_report_duplicate_rate_and_unique_counts_are_consistent_with_clips_on_disk', () => {
    const { report, clips } = site;
    const extraOccurrences = clips.reduce((n, c) => n + c.occurrences.length - 1, 0);
    expect(report.kept).toBe(clips.length);
    expect(report.uniqueEpisodes).toBe(new Set(clips.map((c) => c.episode.id)).size);
    expect(report.duplicates).toBe(extraOccurrences);
    expect(report.duplicateRate).toBeCloseTo(report.duplicates / (report.kept + report.duplicates), 10);
    expect(report.rejected).toBe(site.trace.filter((r) => r.type === 'clip-rejected').length);
  });

  it('e2e_every_kept_clip_links_to_trace_records', () => {
    const ids = new Set(site.trace.map((r) => r.id));
    const keptByClip = new Map(site.trace.flatMap((r) => (r.type === 'clip-kept' ? [[r.clipId, r.episodeId] as const] : [])));
    expect(site.clips.length).toBeGreaterThan(0);
    for (const clip of site.clips) {
      expect(clip.traceRefs.length).toBeGreaterThan(0);
      for (const ref of clip.traceRefs) expect(ids.has(ref), `${clip.id} ref ${ref}`).toBe(true);
      expect(keptByClip.get(clip.id)).toBe(clip.episode.id);
    }
  });
});

describe('dataset run edge pages', () => {
  it('e2e_blocked_start_page_stops_with_bot_challenge', async () => {
    const model: ExplorerModel = { next: async () => { throw new Error('explorer must not run on a bot challenge'); } };
    const { report, clips, trace } = await run('blocked.html', model);
    expect(report.stopReason).toBe('bot-challenge');
    expect(report.rejectedByReason['bot-challenge']).toBeGreaterThanOrEqual(1);
    expect(clips).toHaveLength(0);
    expect(trace.some((r) => r.type === 'explorer-step')).toBe(false);
  }, 120_000);

  it('e2e_endless_page_closes_episodes_and_finishes_within_wall_cap', async () => {
    const maxWallMs = 20_000;
    // One step past the cap: a max-duration episode (10 s) plus settle slack and capture.
    const overrunMs = 20_000;
    const model: ExplorerModel = { next: async () => ({ call: call('act', { type: 'wait', ms: 200 }), inputTokens: 0, outputTokens: 0 }) };
    const { report, trace, wallMs } = await run('loop.html', model, { maxWallMs });
    // The report names a cap stop by the cap itself.
    expect(report.stopReason).toBe('wall');
    expect(report.capsHit).toEqual(['wall']);
    expect(wallMs).toBeLessThan(maxWallMs + overrunMs);
    const episodes = trace.filter((r) => r.type === 'episode');
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes.some((r) => r.detail?.startsWith('max-duration'))).toBe(true);
    expect(trace.at(-1)?.type).toBe('run-end');
  }, 120_000);
});
