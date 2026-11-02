import sharp from 'sharp';
import type { Page, Response } from 'playwright';
import { originOf, type Engine } from '../../mcp/engine.js';
import { StructuralPipeline } from '../../pipelines/structural/index.js';
import type { TimelineEvent } from '../../pipelines/temporal/collectors/types.js';
import type { SceneGraph, SceneNode } from '../../types/scene-graph.js';
import type { StructuralNode } from '../../types/structural.js';
import { FrameTimingRecorder, summarizeFrameTiming, toWallClockUs, type TraceEvent } from '../capture/frame-timing.js';
import { PAGE_OBSERVERS_SCRIPT, readPageObservers } from '../capture/page-observers.js';
import { ScreencastRecorder, type CapturedFrame } from '../capture/screencast-recorder.js';
import { SiteMap } from '../sitemap/sitemap.js';
import type { RunBudget } from '../budget.js';
import type { ClipStore } from '../store/clip-store.js';
import type { TraceWriter } from '../trace/trace-writer.js';
import type { Clip, Episode, Measurements, Trigger } from '../types.js';
import { DedupIndex, episodeFingerprint, framesPHash } from './dedup.js';
import { classifyJunk } from './junk-filter.js';
import { detectFlashes, fitEasing, measuredDuration, motionEnergy } from './measure.js';
import { replayReducedMotion } from './reduced-motion.js';
import { SEGMENTER_DEFAULTS, Segmenter, type SegmenterOptions } from './segmenter.js';

export interface RecorderDeps {
  engine: Engine; trace: TraceWriter; store: ClipStore; siteMap: SiteMap;
  runId: string; site: string; segmenterOptions?: Partial<SegmenterOptions>;
  /** Once exceeded, settles stop waiting and replays are skipped, so one step cannot overrun the wall cap. */
  budget?: Pick<RunBudget, 'exceeded'>;
  /** The allowed origin (spec 5.1); nothing seen on another origin becomes a clip. Throwing counts as off-origin. */
  origin?: () => string;
}

const TICK_MS = 50;
const SETTLE_SLACK_MS = 2_000;
const KEYFRAMES = 4;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

interface Snapshot { graph: SceneGraph; png: Buffer }
interface AfterState extends Snapshot {
  nodes: StructuralNode[]; nodeMap: ReadonlyMap<string, StructuralNode>; title: string; frameSrcs: string[];
}
/** Trace events re-timed to wall-clock µs (stable across the stream clock's per-navigation re-anchoring),
 * plus the wall ms tracing has covered since. */
interface TraceWindow { events: TraceEvent[]; coveredFromWallMs: number }

const ROLE_KINDS: [RegExp, string][] = [
  [/^(dialog|alertdialog)$/, 'modal'],
  [/^(menu|menubar|menuitem\w*)$/, 'menu'],
  [/^(listbox|combobox|option|select)$/, 'dropdown'],
  [/^(tab|tablist|tabpanel)$/, 'tab'],
  [/^(details|summary)$/, 'accordion'],
];

/** Heuristic from trigger kind plus target tag/role (ruling R7); Task 15 consumes it. */
export function classifyKind(episode: Episode, targetScenes: SceneNode[]): string {
  if (episode.passive && episode.ambientLoop) return 'loop';
  if (episode.trigger.kind === 'page-load') return 'page-load';
  if (episode.trigger.kind === 'scroll-step') return 'scroll';
  const words = targetScenes.flatMap((s) => [s.role, s.tag]);
  for (const [re, kind] of ROLE_KINDS) if (words.some((w) => re.test(w))) return kind;
  if (episode.trigger.action?.type === 'hover') return 'hover';
  if (words.includes('button')) return 'button';
  return episode.ambientLoop ? 'loop' : 'other';
}

async function keyframesOf(frames: CapturedFrame[]): Promise<Buffer[]> {
  if (frames.length === 0) return [];
  const idx = [...new Set(Array.from({ length: KEYFRAMES }, (_, i) => Math.round((i * (frames.length - 1)) / (KEYFRAMES - 1))))];
  return Promise.all(idx.map((i) => sharp(frames[i].jpeg).png().toBuffer()));
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Recorder {
  private readonly opts: SegmenterOptions;
  private readonly segmenter: Segmenter;
  private readonly dedup = new DedupIndex();
  private readonly structural = new StructuralPipeline();
  private page?: Page;
  private screencast?: ScreencastRecorder;
  private frameTiming?: FrameTimingRecorder;
  private traceSinceWallMs = 0;
  private documentStatus: number | null = null;
  private replaying = false;
  private step = 0;
  private clipSeq = 0;
  private pending?: { triggerId: string; before?: Snapshot; traceRef: string };
  private last?: Snapshot;
  /** Episodes closed by a main-frame navigation, with frames read before the clock re-anchored. */
  private navClosed: { ep: Episode; frames: CapturedFrame[]; wallAnchorMs: number }[] = [];
  private readonly counts = { kept: 0, rejected: 0, duplicates: 0 };
  private unsubscribe: () => void = () => undefined;

  private offOrigin(url: string): boolean {
    if (!this.deps.origin) return false;
    try {
      return originOf(url) !== this.deps.origin();
    } catch {
      return true;
    }
  }

  constructor(private readonly deps: RecorderDeps) {
    this.opts = { ...SEGMENTER_DEFAULTS, ...deps.segmenterOptions };
    this.segmenter = new Segmenter(this.opts);
  }

  /** Stream-clock ms, the clock collectors stamp events with. */
  now(): number {
    const n = this.deps.engine.eventStream.getNormalizer();
    return n ? n.fromWallTimeMs(Date.now()) : Date.now();
  }

  async start(): Promise<void> {
    const { engine } = this.deps;
    await engine.ensureLaunched();
    await engine.ensureStreamAttached();
    const page = engine.runtime.getPage();
    this.page = page;
    await page.addInitScript(PAGE_OBSERVERS_SCRIPT);
    await page.evaluate(PAGE_OBSERVERS_SCRIPT);
    this.screencast = new ScreencastRecorder(page, () => engine.eventStream.getNormalizer());
    await this.screencast.start();
    this.frameTiming = new FrameTimingRecorder(page);
    await this.frameTiming.start();
    this.traceSinceWallMs = Date.now();

    const onEvent = (e: TimelineEvent) => { if (!this.replaying) this.segmenter.onEvent(e); };
    let epochUrl = page.url();
    const onNav = (f: unknown) => {
      if (this.replaying || f !== page.mainFrame()) return;
      // Episodes that ran on an off-origin http page (a redirect the guard bounced) are dropped with their frames.
      const leftOffOrigin = /^https?:/.test(epochUrl) && this.offOrigin(epochUrl);
      epochUrl = page.url();
      const t = this.now();
      const wallAnchorMs = Date.now() - t; // the closing epoch's stream-to-wall offset
      this.segmenter.onNavigated(t);
      // The stream clock re-anchors to ~0 after a navigation, so old-epoch frames would alias into
      // new-page episodes: read the closed episodes' frames now, then empty the buffer.
      for (const ep of this.segmenter.tick(t)) {
        if (leftOffOrigin) continue;
        this.navClosed.push({ ep, frames: this.screencast?.framesBetween(ep.startTs, ep.endTs) ?? [], wallAnchorMs });
      }
      this.screencast?.dropBefore(Infinity);
    };
    const onResponse = (r: Response) => {
      if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) this.documentStatus = r.status();
    };
    engine.eventStream.on('event', onEvent);
    page.on('framenavigated', onNav);
    page.on('response', onResponse);
    this.unsubscribe = () => {
      engine.eventStream.off('event', onEvent);
      page.off('framenavigated', onNav);
      page.off('response', onResponse);
    };
  }

  async beginTrigger(t: Trigger): Promise<void> {
    this.step++;
    let before: Snapshot | undefined;
    try {
      before = await this.snapshot();
    } catch (e) {
      this.traceError(`before-state capture failed: ${errMessage(e)}`);
    }
    const traceRef = this.deps.trace.write({ type: 'trigger', step: this.step, triggerId: t.id, detail: t.kind });
    this.pending = { triggerId: t.id, before, traceRef };
    // Re-stamped on the stream clock so it is comparable with event timestamps.
    this.segmenter.onTrigger({ ...t, timestamp: this.now() });
  }

  async awaitSettle(): Promise<Episode[]> {
    const deadline = Date.now() + this.opts.maxEpisodeMs + this.opts.settleMs + SETTLE_SLACK_MS;
    const episodes = [...this.navClosed.map((n) => n.ep), ...this.segmenter.tick(this.now())];
    while (this.segmenter.isOpen && Date.now() < deadline && !this.deps.budget?.exceeded()) {
      await new Promise((r) => setTimeout(r, TICK_MS));
      episodes.push(...this.segmenter.tick(this.now()));
    }
    await this.processAll(episodes);
    return episodes;
  }

  async stop(): Promise<{ kept: number; rejected: number; duplicates: number }> {
    await this.processAll([...this.navClosed.map((n) => n.ep), ...this.segmenter.flush(this.now())]);
    this.unsubscribe();
    await this.screencast?.stop();
    await this.frameTiming?.stopAndCollect().catch(() => undefined);
    await this.deps.store.saveSiteMap(this.deps.runId, this.deps.siteMap.toJSON());
    return { ...this.counts };
  }

  private get activePage(): Page {
    if (!this.page) throw new Error('Recorder not started');
    return this.page;
  }

  private traceError(message: string): void {
    this.deps.trace.write({ type: 'error', step: this.step, message });
  }

  private async snapshot(): Promise<Snapshot> {
    const graph = await this.deps.engine.captureGraph(false);
    return { graph, png: await this.deps.engine.runtime.screenshot() };
  }

  private async captureAfter(): Promise<AfterState> {
    const page = this.activePage;
    const snap = await this.snapshot();
    // ponytail: second DOM walk beside captureGraph's; ids are positional so they match unless the DOM mutates in between
    const nodes = await this.structural.extractStructure(page);
    return {
      ...snap, nodes, nodeMap: new Map(nodes.map((n) => [n.id, n])),
      title: await page.title().catch(() => ''),
      frameSrcs: page.frames().map((f) => f.url()),
    };
  }

  /** R3: tracing runs continuously; restart it at each settle boundary and keep the closed window. */
  private async rotateTrace(): Promise<TraceWindow | null> {
    const ft = this.frameTiming;
    if (!ft) return null;
    try {
      const raw = await ft.stopAndCollect();
      const sync = ft.syncWallMs;
      const coveredFromWallMs = this.traceSinceWallMs;
      await ft.start();
      this.traceSinceWallMs = Date.now();
      const events = toWallClockUs(raw, sync);
      if (!events) this.traceError('frame timing trace has no sync marker; frameTiming is null for this window');
      return events && { events, coveredFromWallMs };
    } catch (e) {
      this.traceError(`frame timing trace failed: ${errMessage(e)}`);
      return null;
    }
  }

  private async processAll(episodes: Episode[]): Promise<void> {
    if (episodes.length === 0 || !this.screencast) return;
    const screencast = this.screencast;
    // Frames are read up front: a reduced-motion replay drops the recorder's buffer.
    const stashed = new Map(this.navClosed.map((n) => [n.ep.id, n]));
    this.navClosed = [];
    const frames = episodes.map((ep) => stashed.get(ep.id)?.frames ?? screencast.framesBetween(ep.startTs, ep.endTs));
    // Taken before the replay, which navigates and re-anchors the stream clock.
    const currentAnchor = Date.now() - this.now();
    const anchors = episodes.map((ep) => stashed.get(ep.id)?.wallAnchorMs ?? currentAnchor);
    const window = await this.rotateTrace();
    let after: AfterState;
    try {
      after = await this.captureAfter();
    } catch (e) {
      this.traceError(`after-state capture failed: ${errMessage(e)}`);
      return;
    }
    if (this.offOrigin(after.graph.url)) {
      this.traceError(`off-origin page ${originOf(after.graph.url)}: ${episodes.length} episodes dropped`);
      screencast.dropBefore(Number.POSITIVE_INFINITY);
      this.pending = undefined;
      return;
    }
    for (const [i, ep] of episodes.entries()) {
      try {
        await this.processEpisode(ep, frames[i], after, window, anchors[i]);
      } catch (e) {
        this.traceError(`episode ${ep.id}: ${errMessage(e)}`);
      }
    }
    screencast.dropBefore(Math.max(...episodes.map((e) => e.endTs)));
    this.last = after;
    this.pending = undefined;
  }

  private async measure(
    ep: Episode, frames: CapturedFrame[], window: TraceWindow | null, wallAnchorMs: number,
  ): Promise<Omit<Measurements, 'reducedMotion'>> {
    const vp = this.activePage.viewportSize() ?? DEFAULT_VIEWPORT;
    const [measuredDurationMs, fittedEasing, flashes, observers] = await Promise.all([
      measuredDuration(frames), fitEasing(frames), detectFlashes(frames, vp), this.observersSince(ep.startTs),
    ]);
    const scores = ep.animations.map((a) => a.deviation?.score).filter((s): s is number => s !== undefined);
    const startWallMs = ep.startTs + wallAnchorMs;
    // Covered from the trigger on; the pre-roll may predate the rotation that started this window.
    const timing = window && startWallMs + this.opts.preRollMs >= window.coveredFromWallMs
      ? summarizeFrameTiming(window.events, startWallMs * 1000, (ep.endTs + wallAnchorMs) * 1000)
      : null;
    const spanMs = frames.length > 1 ? frames[frames.length - 1].ts - frames[0].ts : 0;
    return {
      declared: ep.animations.map((a) => ({ durationMs: a.duration, delayMs: a.delay, ...(a.easing ? { easing: a.easing } : {}) })),
      measuredDurationMs,
      fittedEasing,
      deviationScore: scores.length ? Math.max(...scores) : null,
      // No DrawFrame in the window means no evidence, not a jank-free clip.
      frameTiming: timing && timing.frames > 0 ? { ...timing, longAnimationFrames: observers.longAnimationFrames } : null,
      layoutShift: observers.layoutShift,
      flashes,
      framesCaptured: frames.length,
      achievedFps: spanMs > 0 ? ((frames.length - 1) * 1000) / spanMs : 0,
    };
  }

  /** Page observers use the page's performance clock; offset it from the stream clock now. */
  private async observersSince(streamTs: number): Promise<{ longAnimationFrames: number; layoutShift: number }> {
    const page = this.activePage;
    const pageNow = (await page.evaluate(() => performance.now())) as number;
    return readPageObservers(page, pageNow - (this.now() - streamTs));
  }

  private async processEpisode(
    ep: Episode, frames: CapturedFrame[], after: AfterState, window: TraceWindow | null, wallAnchorMs: number,
  ): Promise<void> {
    const { trace, store, runId, site, siteMap } = this.deps;
    const own = this.pending?.triggerId === ep.trigger.id ? this.pending : undefined;
    const before = own?.before ?? this.last ?? after;
    const episodeRef = trace.write({ type: 'episode', step: this.step, episodeId: ep.id, detail: `${ep.closeReason}, ${ep.animations.length} animations` });

    const markers = new Set(ep.animations.map((a) => a.targetMarker).filter((m): m is string => !!m));
    const targets = after.nodes.filter((n) => markers.has(n.attributes['data-uipe-anim']));
    const targetIds = new Set(targets.map((t) => t.id));
    const targetScenes = after.graph.nodes.filter((s) => targetIds.has(s.id));

    const keyframes = await keyframesOf(frames);
    const verdict = await classifyJunk({
      episode: ep, before: before.graph, after: after.graph, documentStatus: this.documentStatus, frames, targets, targetScenes,
      nodeMap: after.nodeMap, pageTitle: after.title, frameSrcs: after.frameSrcs,
      viewport: this.activePage.viewportSize() ?? DEFAULT_VIEWPORT, preRollMs: this.opts.preRollMs,
    });
    if (!verdict.keep) {
      await store.saveRejected(runId, ep.id, verdict.reason, keyframes[Math.floor(keyframes.length / 2)] ?? null);
      trace.write({ type: 'clip-rejected', step: this.step, episodeId: ep.id, reason: verdict.reason, detail: verdict.detail });
      this.counts.rejected++;
      return;
    }

    // Measured only once kept: decoding every frame of a 10 s rejected episode costs tens of seconds.
    const measured = await this.measure(ep, frames, window, wallAnchorMs);
    const stateId = ep.trigger.stateId || SiteMap.stateIdFor(after.graph.url, after.graph);
    const occurrence = { url: after.graph.url, stateId, triggerId: ep.trigger.id };
    const fingerprint = episodeFingerprint(ep, targets, after.nodeMap);
    const phash = await framesPHash(keyframes);
    // No animations means an empty, shared fingerprint, so pixels decide.
    const dup = this.dedup.check(fingerprint, phash, ep.motionOnly || ep.animations.length === 0);
    if (dup) {
      await store.addOccurrence(runId, dup.duplicateOf, occurrence);
      trace.write({ type: 'clip-duplicate', step: this.step, episodeId: ep.id, duplicateOf: dup.duplicateOf });
      this.counts.duplicates++;
      return;
    }

    const reducedMotion: Measurements['reducedMotion'] = this.deps.budget?.exceeded()
      ? { status: 'not-reproducible', reason: 'budget-exhausted' }
      : await this.replay(ep, frames);
    const id = `clip-${String(++this.clipSeq).padStart(4, '0')}`;
    const firstStart = ep.animations.length ? Math.min(...ep.animations.map((a) => a.startTs)) : null;
    const clip: Clip = {
      schemaVersion: 1, id, runId, site, url: after.graph.url, stateId, episode: ep,
      kind: classifyKind(ep, targetScenes),
      measurements: { ...measured, reducedMotion },
      fingerprint, phash, occurrences: [occurrence],
      files: { frames: [], keyframes: [], beforePng: '', afterPng: '', beforeScene: '', afterScene: '' },
      actionLatencyMs: ep.trigger.action && firstStart !== null ? firstStart - ep.trigger.timestamp : null,
      actionSucceeded: null,
      traceRefs: [...(own ? [own.traceRef] : []), episodeRef],
    };
    await store.saveClip(clip, {
      frames: frames.map((f) => f.jpeg), keyframes, beforePng: before.png, afterPng: after.png,
      beforeScene: before.graph, afterScene: after.graph,
    });
    trace.write({ type: 'clip-kept', step: this.step, episodeId: ep.id, clipId: id });
    this.dedup.add(id, fingerprint, phash);
    siteMap.addClip(ep.trigger.id, id);
    this.counts.kept++;
  }

  private async replay(ep: Episode, frames: CapturedFrame[]): Promise<Measurements['reducedMotion']> {
    this.replaying = true; // the replay's own animations and navigations must not open episodes
    try {
      return await replayReducedMotion({
        page: this.activePage, siteMap: this.deps.siteMap, stateId: ep.trigger.stateId, trigger: ep.trigger,
        recorder: this.screencast!, settleMs: ep.endTs - ep.startTs + this.opts.settleMs, normalMotion: await motionEnergy(frames),
      });
    } finally {
      this.replaying = false;
    }
  }
}
