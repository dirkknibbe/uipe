import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBrowseServer } from '../../../../src/dataset/browse/server.js';
import { LocalClipStore } from '../../../../src/dataset/store/clip-store.js';
import type { Clip } from '../../../../src/dataset/types.js';

const clip = (id: string, kind = 'button'): Clip => ({
  schemaVersion: 1, id, runId: 'r1', site: 'x.test', url: 'http://x.test/', stateId: 's1',
  episode: { id: `ep-${id}`, trigger: { id: 't1', kind: 'action', timestamp: 0, stateId: 's1' }, startTs: 0, endTs: 100, closeReason: 'settled', animations: [], passive: false, ambientLoop: false, motionOnly: false },
  kind,
  measurements: { declared: [], measuredDurationMs: null, fittedEasing: null, deviationScore: null, frameTiming: null, layoutShift: 0, flashes: { general: 0, red: 0, failsWcag231: false }, reducedMotion: { status: 'not-reproducible', reason: 'error' }, framesCaptured: 2, achievedFps: 20 },
  fingerprint: 'f', phash: 'p', occurrences: [], files: { frames: [], keyframes: [], beforePng: '', afterPng: '', beforeScene: '', afterScene: '' },
  actionLatencyMs: null, actionSucceeded: null, traceRefs: [],
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((f) => f())); });

async function setup(nClips = 50) {
  const root = await mkdtemp(join(tmpdir(), 'uipe-browse-'));
  const run = join(root, 'runs', 'r1');
  for (let i = 0; i < nClips; i++) {
    const id = `clip-${String(i).padStart(4, '0')}`;
    await mkdir(join(run, 'clips', id), { recursive: true });
    await writeFile(join(run, 'clips', id, 'clip.json'), JSON.stringify(clip(id, i % 2 ? 'modal' : 'button')));
  }
  await mkdir(join(run, 'rejected'), { recursive: true });
  await writeFile(join(run, 'rejected', 'ep-9.json'), JSON.stringify({ episodeId: 'ep-9', reason: 'blank' }));
  await writeFile(join(run, 'rejected', 'ep-9.png'), 'png');
  await writeFile(join(run, 'report.json'), JSON.stringify({ runId: 'r1', site: 'x.test', stopReason: 'completed', kept: nClips, rejected: 0, duplicates: 0, rejectedByReason: {}, uniqueEpisodes: nClips, states: 1, transitions: 1, capsHit: [], usd: 0, usdPerKeptClip: null, duplicateRate: 0, junkRateEstimate: null, passes: { minUniqueEpisodes: true, maxDuplicateRate: true } }));
  await writeFile(join(run, 'secret.txt'), 'inside');
  await writeFile(join(root, 'outside.txt'), 'outside');
  const srv = await startBrowseServer({ root, port: 0 });
  cleanups.push(() => srv.close(), () => rm(root, { recursive: true, force: true }));
  return { root, run, srv };
}
const get = async (url: string) => { const r = await fetch(url); return { status: r.status, body: await r.text() }; };

describe('browse server', () => {
  it('binds_loopback_only', async () => {
    const { srv } = await setup(1);
    expect(new URL(srv.url).hostname).toBe('127.0.0.1');
  });

  it('lists_runs_clips_filters_and_rejected', async () => {
    const { srv } = await setup(4);
    expect(JSON.parse((await get(`${srv.url}/api/runs`)).body)).toEqual([{ runId: 'r1', site: 'x.test', report: expect.objectContaining({ kept: 4 }) }]);
    const modals = JSON.parse((await get(`${srv.url}/api/runs/r1/clips?kind=modal`)).body);
    expect(modals.map((c: Clip) => c.id)).toEqual(['clip-0001', 'clip-0003']);
    expect(JSON.parse((await get(`${srv.url}/api/runs/r1/clips?site=nope`)).body)).toEqual([]);
    expect(JSON.parse((await get(`${srv.url}/api/runs/r1/rejected`)).body)).toEqual([
      { episodeId: 'ep-9', reason: 'blank', detail: '', keyframe: 'rejected/ep-9.png' },
    ]);
  });

  it('sample_is_seeded_and_stable', async () => {
    const { srv } = await setup(50);
    const s = async (q: string) => JSON.parse((await get(`${srv.url}/api/runs/r1/sample?${q}`)).body) as string[];
    const a = await s('n=40&seed=7');
    expect(a).toHaveLength(40);
    expect(new Set(a).size).toBe(40);
    expect(await s('n=40&seed=7')).toEqual(a);
    expect(await s('n=40&seed=8')).not.toEqual(a);
  });

  it('path_traversal_returns_403', async () => {
    const { srv } = await setup(1);
    expect((await get(`${srv.url}/files/r1/secret.txt`)).body).toBe('inside');
    // fetch normalizes ../, so send the raw path
    const raw = (path: string) => new Promise<number>((resolve, reject) => {
      const u = new URL(srv.url);
      request({ host: u.hostname, port: u.port, path }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject).end();
    });
    expect(await raw('/files/r1/../../outside.txt')).toBe(403);
    expect(await raw('/files/r1/%2e%2e/%2e%2e/outside.txt')).toBe(403);
    expect(await raw('/files/..%2f/x')).toBe(403);
  });

  it('serves_real_saved_clip_assets_at_clip_relative_urls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uipe-browse-'));
    const srv = await startBrowseServer({ root, port: 0 });
    cleanups.push(() => srv.close(), () => rm(root, { recursive: true, force: true }));
    const buf = Buffer.from('jpg');
    const scene = {} as never;
    const saved = await new LocalClipStore(root).saveClip(clip('c1'), { frames: [buf], keyframes: [], beforePng: buf, afterPng: buf, beforeScene: scene, afterScene: scene });
    for (const rel of [saved.files.frames[0], saved.files.beforePng, saved.files.afterPng]) {
      expect((await get(`${srv.url}/files/r1/clips/c1/${rel}`)).status).toBe(200);
    }
    const html = (await get(`${srv.url}/`)).body;
    expect(html).toContain('clips/${clip.id}/${rel}');
  });

  it('handcheck_40_updates_report_junk_rate', async () => {
    const { srv, run } = await setup(50);
    const post = (clipId: string, junk: boolean) => fetch(`${srv.url}/api/runs/r1/handcheck`, { method: 'POST', body: JSON.stringify({ clipId, junk }) });
    for (let i = 0; i < 39; i++) expect((await post(`clip-${String(i).padStart(4, '0')}`, i < 4)).status).toBe(200);
    expect(JSON.parse(await readFile(join(run, 'report.json'), 'utf8')).junkRateEstimate).toBeNull();
    await post('clip-0039', false);
    expect(JSON.parse(await readFile(join(run, 'report.json'), 'utf8')).junkRateEstimate).toBeCloseTo(4 / 40);
    expect((await readFile(join(run, 'handcheck.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(40);
    expect(await readFile(join(run, 'report.md'), 'utf8')).toContain('junk: 10.0% (hand-check');
    expect((await post('../x', true)).status).toBe(400);
  });
});
