import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { LocalClipStore, datasetRoot } from '../../../../src/dataset/store/clip-store.js';
import type { Clip } from '../../../../src/dataset/types.js';
import type { SceneGraph } from '../../../../src/types/scene-graph.js';

const scene = { timestamp: 0, url: 'http://x', viewport: { width: 1280, height: 720 }, scrollPosition: { x: 0, y: 0 }, nodes: [], rootNodeIds: [] } as SceneGraph;
const clip = (id: string): Clip => ({
  schemaVersion: 1, id, runId: 'r1', site: 'x.test', url: 'http://x.test/', stateId: 's1',
  episode: { id: 'ep-1', trigger: { id: 't1', kind: 'action', timestamp: 0, stateId: 's1' }, startTs: 0, endTs: 100, closeReason: 'settled', animations: [], passive: false, ambientLoop: false, motionOnly: false },
  kind: 'button',
  measurements: { declared: [], measuredDurationMs: null, fittedEasing: null, deviationScore: null, frameTiming: null, layoutShift: 0, flashes: { general: 0, red: 0, failsWcag231: false }, reducedMotion: { status: 'not-reproducible', reason: 'error' }, framesCaptured: 2, achievedFps: 0 },
  fingerprint: 'f', phash: 'p', occurrences: [{ url: 'http://x.test/', stateId: 's1', triggerId: 't1' }],
  files: { frames: [], keyframes: [], beforePng: '', afterPng: '', beforeScene: '', afterScene: '' },
  actionLatencyMs: null, actionSucceeded: null, traceRefs: [],
});
const assets = { frames: [Buffer.from('j0'), Buffer.from('j1')], keyframes: [Buffer.from('k0')], beforePng: Buffer.from('b'), afterPng: Buffer.from('a'), beforeScene: scene, afterScene: scene };

const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'uipe-store-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('LocalClipStore', () => {
  it('save_clip_writes_layout_and_relative_paths', async () => {
    const store = new LocalClipStore(await tmp());
    const saved = await store.saveClip(clip('clip-0001'), assets);
    const dir = join(store.runDir('r1'), 'clips', 'clip-0001');
    expect(saved.files).toEqual({
      frames: ['frames/0000.jpg', 'frames/0001.jpg'], keyframes: ['keyframes/00.png'],
      beforePng: 'before.png', afterPng: 'after.png', beforeScene: 'before-scene.json', afterScene: 'after-scene.json',
    });
    for (const f of [...saved.files.frames, ...saved.files.keyframes, 'before.png', 'after.png', 'before-scene.json', 'after-scene.json']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    expect(await readFile(join(dir, 'frames/0001.jpg'), 'utf8')).toBe('j1');
    expect(JSON.parse(await readFile(join(dir, 'clip.json'), 'utf8'))).toEqual(saved);

    await store.addOccurrence('r1', 'clip-0001', { url: 'http://x.test/b', stateId: 's2', triggerId: 't2' });
    const [listed] = await store.listClips('r1');
    expect(listed.occurrences.map((o) => o.triggerId)).toEqual(['t1', 't2']);

    await store.saveRejected('r1', 'ep-2', 'blank', Buffer.from('png'));
    expect(JSON.parse(await readFile(join(store.runDir('r1'), 'rejected', 'ep-2.json'), 'utf8'))).toMatchObject({ episodeId: 'ep-2', reason: 'blank' });
    expect(existsSync(join(store.runDir('r1'), 'rejected', 'ep-2.png'))).toBe(true);
    await store.saveSiteMap('r1', { version: 1, site: 'x', startUrl: 'http://x/', states: [], transitions: [] });
    expect(existsSync(join(store.runDir('r1'), 'sitemap.json'))).toBe(true);
  });

  it('dataset_root_honors_env_override', () => {
    const prev = process.env.UIPE_DATASET_DIR;
    try {
      process.env.UIPE_DATASET_DIR = '/tmp/custom-ds';
      expect(datasetRoot()).toBe('/tmp/custom-ds');
      delete process.env.UIPE_DATASET_DIR;
      expect(datasetRoot()).toBe(join(homedir(), '.uipe', 'dataset'));
    } finally {
      if (prev === undefined) delete process.env.UIPE_DATASET_DIR; else process.env.UIPE_DATASET_DIR = prev;
    }
  });

  it('list_clips_skips_corrupt_clip_json', async () => {
    const store = new LocalClipStore(await tmp());
    await store.saveClip(clip('clip-0001'), assets);
    const bad = join(store.runDir('r1'), 'clips', 'clip-0002');
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, 'clip.json'), '{"trunc');
    await mkdir(join(store.runDir('r1'), 'clips', 'clip-0003'), { recursive: true });
    expect((await store.listClips('r1')).map((c) => c.id)).toEqual(['clip-0001']);
    expect(await store.listClips('missing-run')).toEqual([]);
    expect((await readdir(join(store.runDir('r1'), 'clips'))).length).toBe(3);
  });

  it('rejects_ids_that_escape_the_run_dir', async () => {
    const store = new LocalClipStore(await tmp());
    expect(() => store.runDir('../evil')).toThrow();
    await expect(store.saveRejected('r1', '../../x', 'blank', null)).rejects.toThrow();
  });
});
