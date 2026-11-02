import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CapturedFrame } from '../../../../src/dataset/capture/screencast-recorder.js';
import type { StructuralNode } from '../../../../src/types/structural.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/scene-graph.js';
import type { Episode, Trigger } from '../../../../src/dataset/types.js';

// liveBuffer: the mock screencast filters by ts and honors dropBefore, like the real buffer.
const fake = vi.hoisted(() => ({ frames: [] as CapturedFrame[], nodes: [] as unknown[], liveBuffer: false, traceMarker: true }));
// Chromium trace ts are µs on the TimeTicks base (~4.17e12 in a real probe), unrelated to any page clock.
const TICKS_BASE_US = 4_170_400_766_123;

vi.mock('../../../../src/dataset/capture/screencast-recorder.js', () => ({
  ScreencastRecorder: class {
    async start() {}
    async stop() {}
    dropBefore(ts: number) { if (fake.liveBuffer) fake.frames = fake.frames.filter((f) => f.ts >= ts); }
    framesBetween(a: number, b: number) { return fake.liveBuffer ? fake.frames.filter((f) => f.ts >= a && f.ts <= b) : fake.frames; }
  },
}));
vi.mock('../../../../src/dataset/capture/frame-timing.js', async (orig) => ({
  ...(await orig<object>()),
  /** A DrawFrame every 16 ms from start() to stopAndCollect(), anchored by a sync TimeStamp at start(). */
  FrameTimingRecorder: class {
    syncWallMs: number | null = null;
    async start() { this.syncWallMs = Date.now(); }
    async stopAndCollect() {
      const spanUs = (Date.now() - this.syncWallMs!) * 1000;
      const draws = Array.from({ length: Math.floor(spanUs / 16_000) + 1 }, (_, i) => ({ name: 'DrawFrame', cat: 'c', ph: 'I', ts: TICKS_BASE_US + i * 16_000 }));
      const mark = { name: 'TimeStamp', cat: 'devtools.timeline', ph: 'I', ts: TICKS_BASE_US, args: { data: { message: 'uipe-sync' } } };
      return fake.traceMarker ? [mark, ...draws] : draws;
    }
  },
}));
vi.mock('../../../../src/dataset/capture/page-observers.js', () => ({
  PAGE_OBSERVERS_SCRIPT: '',
  readPageObservers: async () => ({ longAnimationFrames: 2, layoutShift: 0.05 }),
}));
vi.mock('../../../../src/pipelines/structural/index.js', () => ({
  StructuralPipeline: class { async extractStructure() { return fake.nodes; } },
}));

const { Recorder, classifyKind } = await import('../../../../src/dataset/recorder/recorder.js');
const { LocalClipStore } = await import('../../../../src/dataset/store/clip-store.js');
const { TraceWriter, readTrace } = await import('../../../../src/dataset/trace/trace-writer.js');
const { SiteMap } = await import('../../../../src/dataset/sitemap/sitemap.js');

const VP = { width: 1280, height: 720 };
const T0 = Date.now();

async function frame(i: number, boxX: number): Promise<CapturedFrame> {
  const box = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#000' } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#fff' } })
    .composite([{ input: box, left: boxX, top: 50 }]).jpeg({ quality: 95 }).toBuffer();
  return { ts: i * 16, jpeg, scrollX: 0, scrollY: 0 };
}
const movingFrames = () => Promise.all([0, 1, 2, 3, 4, 5].map((i) => frame(i, 10 + i * 40)));

const snode = (id: string, marker: string): StructuralNode => ({
  id, tag: 'button', role: 'button', boundingBox: { x: 100, y: 100, width: 200, height: 50 },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'pointer' },
  attributes: { class: 'cta', 'data-uipe-anim': marker },
  states: { isVisible: true, isInteractable: true, isDisabled: false, isFocused: false, isEditable: false },
  children: [],
});
const scene = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  id, tag: 'button', role: 'button', label: 'Go', boundingBox: { x: 100, y: 100, width: 200, height: 50 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0, interactionType: 'clickable', isDisabled: false,
  isLoading: false, isFocused: false, visualState: 'normal', children: [], ...extra,
} as SceneNode);

const pageUrl = { value: 'https://x.test/' };

function fakeEngine(title: { value: string }) {
  const stream = Object.assign(new EventEmitter(), {
    getNormalizer: () => ({ fromWallTimeMs: (w: number) => w - T0, fromPerformanceNow: (p: number) => p, fromCdpMonotonicSeconds: (s: number) => s * 1000 }),
  });
  const page: any = Object.assign(new EventEmitter(), {
    addInitScript: async () => undefined,
    evaluate: async () => 0,
    title: async () => title.value,
    url: () => pageUrl.value,
    frames: () => [{ url: () => 'https://x.test/' }],
    mainFrame: () => null,
    viewportSize: () => VP,
  });
  const graph = (): SceneGraph => ({
    timestamp: 0, url: pageUrl.value, viewport: VP, scrollPosition: { x: 0, y: 0 },
    nodes: (fake.nodes as StructuralNode[]).map((n) => scene(n.id)), rootNodeIds: [],
  });
  const png = sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();
  const engine: any = {
    runtime: { getPage: () => page, screenshot: () => png, currentUrl: () => 'https://x.test/' },
    eventStream: stream,
    ensureLaunched: async () => undefined,
    ensureStreamAttached: async () => undefined,
    captureGraph: async () => graph(),
  };
  return { engine, stream };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'uipe-rec-')); fake.frames = await movingFrames(); fake.liveBuffer = false; fake.traceMarker = true; pageUrl.value = 'https://x.test/'; });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function setup(pageTitle = 'Home', budget?: { exceeded: () => null | 'wall' }, origin?: () => string) {
  const title = { value: pageTitle };
  const { engine, stream } = fakeEngine(title);
  const store = new LocalClipStore(dir);
  const tracePath = join(dir, 'trace.jsonl');
  const trace = new TraceWriter(tracePath, 'r1', 'x.test');
  const siteMap = new SiteMap('x.test', 'https://x.test/');
  const rec = new Recorder({ engine, trace, store, siteMap, runId: 'r1', site: 'x.test', segmenterOptions: { settleMs: 30 }, ...(budget ? { budget } : {}), ...(origin ? { origin } : {}) });
  await rec.start();
  /** one click trigger whose animation runs on the node marked with `marker` */
  const fire = async (id: string, marker: string) => {
    await rec.beginTrigger({ id, kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: marker, name: 'pop', duration: 50, iterations: 1, targetMarker: marker } });
    await new Promise((r) => setTimeout(r, 20));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: marker } });
    return rec.awaitSettle();
  };
  const records = async () => { await trace.flush(); return readTrace(tracePath); };
  return { rec, store, siteMap, fire, records, title, engine, stream };
}

describe('Recorder', () => {
  it('kept_episode_produces_clip_and_trace_record', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, siteMap, fire, records } = await setup();
    const eps = await fire('t1', 'a1');
    expect(eps).toHaveLength(1);
    const [clip] = await store.listClips('r1');
    expect(clip).toMatchObject({ runId: 'r1', site: 'x.test', kind: 'button', stateId: 's1', episode: { id: eps[0].id } });
    expect(clip.files.keyframes).toHaveLength(4);
    expect(clip.files.frames).toHaveLength(6);
    expect(clip.measurements.layoutShift).toBe(0.05);
    expect(clip.measurements.declared).toEqual([{ durationMs: 50, delayMs: 0 }]);
    expect(clip.measurements.reducedMotion).toEqual({ status: 'not-reproducible', reason: 'unreachable-state' });
    const kfDir = join(store.runDir('r1'), 'clips', clip.id);
    const meta = await sharp(await readFile(join(kfDir, clip.files.keyframes[0]))).metadata();
    expect(meta.format).toBe('png');
    const kept = (await records()).filter((r) => r.type === 'clip-kept');
    expect(kept).toMatchObject([{ episodeId: eps[0].id, clipId: clip.id }]);
    siteMap.addTransition({ from: 's1', to: 's2', action: { type: 'click', x: 1, y: 1 }, triggerId: 't1', clipIds: [] });
    expect(siteMap.toJSON().transitions[0].clipIds).toEqual([clip.id]);
    expect(await rec.stop()).toEqual({ kept: 1, rejected: 0, duplicates: 0 });
    expect(existsSync(join(store.runDir('r1'), 'sitemap.json'))).toBe(true);
  });

  it('rejected_episode_writes_reason_and_trace', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, fire, records } = await setup('Just a moment...');
    const [ep] = await fire('t1', 'a1');
    expect(await store.listClips('r1')).toEqual([]);
    const saved = JSON.parse(await readFile(join(store.runDir('r1'), 'rejected', `${ep.id}.json`), 'utf8'));
    expect(saved).toMatchObject({ episodeId: ep.id, reason: 'bot-challenge' });
    expect(existsSync(join(store.runDir('r1'), 'rejected', `${ep.id}.png`))).toBe(true);
    expect((await records()).filter((r) => r.type === 'clip-rejected')).toMatchObject([{ episodeId: ep.id, reason: 'bot-challenge' }]);
    expect(await rec.stop()).toEqual({ kept: 0, rejected: 1, duplicates: 0 });
  });

  it('duplicate_episode_adds_occurrence_not_clip', async () => {
    fake.nodes = [snode('dom-1', 'a1'), snode('dom-2', 'a2')];
    const { rec, store, fire, records } = await setup();
    await fire('t1', 'a1');
    await fire('t2', 'a2');
    const clips = await store.listClips('r1');
    expect(clips).toHaveLength(1);
    expect(clips[0].occurrences.map((o) => o.triggerId)).toEqual(['t1', 't2']);
    expect((await records()).filter((r) => r.type === 'clip-duplicate')).toMatchObject([{ duplicateOf: clips[0].id }]);
    expect(await rec.stop()).toEqual({ kept: 1, rejected: 0, duplicates: 1 });
  });

  it('recorder_survives_measurement_error_and_traces_it', async () => {
    fake.nodes = [snode('dom-1', 'a1'), snode('dom-2', 'b2')];
    const { rec, store, fire, records } = await setup();
    const good = fake.frames;
    fake.frames = [{ ts: 0, jpeg: Buffer.from('not a jpeg'), scrollX: 0, scrollY: 0 }, { ts: 16, jpeg: Buffer.from('nope'), scrollX: 0, scrollY: 0 }];
    await fire('t1', 'a1');
    const errors = (await records()).filter((r) => r.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: expect.stringMatching(/^episode ep-1: .*(unsupported image format|Input buffer)/i) });
    fake.frames = good;
    fake.nodes = [snode('dom-2', 'b2')];
    await fire('t2', 'b2');
    expect(await store.listClips('r1')).toHaveLength(1);
    expect(await rec.stop()).toEqual({ kept: 1, rejected: 0, duplicates: 0 });
  });
});

describe('Recorder frame timing', () => {
  it('maps TimeTicks-based trace µs onto the episode window via the sync marker', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, stream } = await setup();
    await rec.beginTrigger({ id: 't1', kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    const triggerTs = rec.now();
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'a1', name: 'pop', duration: 200, iterations: 1, targetMarker: 'a1' } });
    await new Promise((r) => setTimeout(r, 200));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'a1' } });
    const [ep] = await rec.awaitSettle();
    const ft = (await store.listClips('r1'))[0].measurements.frameTiming!;
    expect(ft).not.toBeNull();
    expect(ft.source).toBe('trace');
    // a DrawFrame every 16 ms while tracing ran: at least the trigger-to-end span, at most the whole window
    expect(ft.frames).toBeGreaterThanOrEqual(Math.floor((ep.endTs - triggerTs) / 16) - 1);
    expect(ft.frames).toBeLessThanOrEqual(Math.ceil((ep.endTs - ep.startTs) / 16) + 1);
    expect(ft.longestFrameMs).toBeCloseTo(16, 0);
    await rec.stop();
  });

  it('frameTiming is null, with a traced error, when the trace has no sync marker', async () => {
    fake.traceMarker = false;
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, fire, records } = await setup();
    await fire('t1', 'a1');
    const [clip] = await store.listClips('r1');
    expect(clip.measurements.frameTiming).toBeNull();
    expect((await records()).some((r) => r.type === 'error' && /sync marker/.test(r.message))).toBe(true);
    await rec.stop();
  });
});

describe('Recorder budget', () => {
  it('stops waiting for settle and skips the replay once the budget is exceeded', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    let exceeded = false;
    const { rec, store, stream } = await setup('Home', { exceeded: () => (exceeded ? 'wall' : null) });
    await rec.beginTrigger({ id: 't1', kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'a1', name: 'pop', duration: 50, iterations: 1, targetMarker: 'a1' } });
    exceeded = true;
    const startedAt = Date.now();
    expect(await rec.awaitSettle()).toEqual([]); // the episode is still open; it is not waited for
    expect(Date.now() - startedAt).toBeLessThan(500);
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'a1' } });
    await rec.stop();
    const [clip] = await store.listClips('r1');
    expect(clip.measurements.reducedMotion).toEqual({ status: 'not-reproducible', reason: 'budget-exhausted' });
  });
});

describe('Recorder navigation', () => {
  it('frames_from_before_a_navigation_do_not_leak_into_later_episodes', async () => {
    fake.nodes = [snode('dom-1', 'a1'), snode('dom-2', 'b2')];
    fake.liveBuffer = true;
    fake.frames = [];
    const { rec, store, engine, stream } = await setup();
    let anchor = T0;
    stream.getNormalizer = () => ({ fromWallTimeMs: (w: number) => w - anchor, fromPerformanceNow: (p: number) => p, fromCdpMonotonicSeconds: (s: number) => s * 1000 });
    const page = engine.runtime.getPage();
    const shiftedFrames = async (boxBase: number) => {
      const t = rec.now();
      return Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => ({ ...(await frame(i, boxBase + i * 20)), ts: t + i * 16 })));
    };

    // page A: episode t1 with frames buffered on the old clock epoch
    await rec.beginTrigger({ id: 't1', kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    const t1Start = rec.now();
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'a1', name: 'pop', duration: 50, iterations: 1, targetMarker: 'a1' } });
    const oldFrames = await shiftedFrames(10);
    fake.frames.push(...oldFrames);
    await new Promise((r) => setTimeout(r, 100));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'a1' } });

    // main-frame navigation; the stream clock re-anchors so new-epoch ts alias page A's
    page.emit('framenavigated', null);
    anchor = Date.now() - t1Start;

    // page B: episode t2 whose window overlaps the stale frames' ts
    await rec.beginTrigger({ id: 't2', kind: 'action', timestamp: 0, stateId: 's2', action: { type: 'click', x: 1, y: 1 } });
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'b2', name: 'slide', duration: 80, iterations: 1, targetMarker: 'b2' } });
    const newFrames = await shiftedFrames(30);
    fake.frames.push(...newFrames);
    await new Promise((r) => setTimeout(r, 100));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'b2' } });
    const eps = await rec.awaitSettle();

    expect(eps.map((e) => e.closeReason)).toEqual(['navigated', 'settled']);
    const clips = await store.listClips('r1');
    const byTrigger = (id: string) => clips.find((c) => c.occurrences.some((o) => o.triggerId === id) || c.episode.trigger.id === id)!;
    expect(byTrigger('t1').files.frames).toHaveLength(oldFrames.length);
    expect(byTrigger('t2').files.frames).toHaveLength(newFrames.length);
    await rec.stop();
  });
});

describe('Recorder origin', () => {
  it('records no clip when the page it would capture is off the allowed origin', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, fire, records } = await setup('Home', undefined, () => 'https://x.test');
    pageUrl.value = 'https://evil.test/';
    await fire('t1', 'a1');
    expect(await store.listClips('r1')).toEqual([]);
    expect((await records()).some((r) => r.type === 'error' && /off-origin/.test(r.message))).toBe(true);
    await rec.stop();
  });

  it('drops episodes that ran on an off-origin page once it is navigated away from', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, engine, stream } = await setup('Home', undefined, () => 'https://x.test');
    const page = engine.runtime.getPage();
    await rec.beginTrigger({ id: 't1', kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    pageUrl.value = 'https://evil.test/';
    page.emit('framenavigated', null);
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'a1', name: 'pop', duration: 50, iterations: 1, targetMarker: 'a1' } });
    await new Promise((r) => setTimeout(r, 20));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'a1' } });
    pageUrl.value = 'https://x.test/'; // the guard's bounce back
    page.emit('framenavigated', null);
    await rec.awaitSettle();
    await rec.stop();
    // t1's own episode closed on-origin at the first navigation and may be kept; nothing from the off-origin page is.
    const clips = await store.listClips('r1');
    expect(clips.flatMap((c) => c.episode.animations.map((a) => a.animationId))).not.toContain('a1');
  });
  it('does_not_keep_a_before_state_snapshotted_on_an_off_origin_page', async () => {
    fake.nodes = [snode('dom-1', 'a1')];
    const { rec, store, records, stream } = await setup('Home', undefined, () => 'https://x.test');
    pageUrl.value = 'https://evil.test/';
    await rec.beginTrigger({ id: 't1', kind: 'action', timestamp: 0, stateId: 's1', action: { type: 'click', x: 1, y: 1 } });
    pageUrl.value = 'https://x.test/';
    stream.emit('event', { type: 'animation-start', timestamp: rec.now(), payload: { animationId: 'a1', name: 'pop', duration: 50, iterations: 1, targetMarker: 'a1' } });
    await new Promise((r) => setTimeout(r, 20));
    stream.emit('event', { type: 'animation-end', timestamp: rec.now(), payload: { animationId: 'a1' } });
    await rec.awaitSettle();
    const [clip] = await store.listClips('r1');
    const before = JSON.parse(await readFile(join(store.runDir('r1'), 'clips', clip.id, clip.files.beforeScene), 'utf8'));
    expect(before.url).toBe('https://x.test/');
    expect((await records()).some((r) => r.type === 'error' && /before-state.*off-origin/.test(r.message))).toBe(true);
    await rec.stop();
  });
});

describe('classifyKind', () => {
  const ep = (trigger: Partial<Trigger> = {}, extra: Partial<Episode> = {}): Episode => ({
    id: 'e', trigger: { id: 't', kind: 'action', timestamp: 0, stateId: 's', action: { type: 'click', x: 0, y: 0 }, ...trigger },
    startTs: 0, endTs: 1, closeReason: 'settled', animations: [], passive: false, ambientLoop: false, motionOnly: false, ...extra,
  });
  it('maps_trigger_kind_and_target_roles_to_kinds', () => {
    expect(classifyKind(ep({ kind: 'page-load' }), [])).toBe('page-load');
    expect(classifyKind(ep({ kind: 'scroll-step' }), [])).toBe('scroll');
    expect(classifyKind(ep({}, { passive: true, ambientLoop: true }), [])).toBe('loop');
    expect(classifyKind(ep(), [scene('a', { role: 'dialog', tag: 'div' })])).toBe('modal');
    expect(classifyKind(ep(), [scene('a', { role: 'menu', tag: 'ul' })])).toBe('menu');
    expect(classifyKind(ep(), [scene('a', { role: 'listbox', tag: 'ul' })])).toBe('dropdown');
    expect(classifyKind(ep(), [scene('a', { role: 'tab' })])).toBe('tab');
    expect(classifyKind(ep(), [scene('a', { role: 'generic', tag: 'details' })])).toBe('accordion');
    expect(classifyKind(ep({ action: { type: 'hover', x: 0, y: 0 } }), [scene('a', { role: 'generic', tag: 'div' })])).toBe('hover');
    expect(classifyKind(ep(), [scene('a')])).toBe('button');
    expect(classifyKind(ep(), [scene('a', { role: 'generic', tag: 'div' })])).toBe('other');
  });
});
