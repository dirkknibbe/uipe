import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { classifyJunk, isBotChallenge, type JunkContext } from '../../../../src/dataset/recorder/junk-filter.js';
import type { CapturedFrame } from '../../../../src/dataset/capture/screencast-recorder.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/scene-graph.js';
import type { StructuralNode } from '../../../../src/types/structural.js';
import type { Episode, EpisodeAnimation } from '../../../../src/dataset/types.js';

const VP = { width: 1280, height: 720 };
const W = 320, H = 180;

async function solid(i: number, bg: string, boxX?: number): Promise<CapturedFrame> {
  let img = sharp({ create: { width: W, height: H, channels: 3, background: bg } });
  if (boxX !== undefined) {
    const p = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#000' } }).png().toBuffer();
    img = img.composite([{ input: p, left: boxX, top: 50 }]);
  }
  return { ts: i * 16, jpeg: await img.jpeg({ quality: 95 }).toBuffer(), scrollX: 0, scrollY: 0 };
}
const movingFrames = () => Promise.all([0, 1, 2, 3].map((i) => solid(i, '#fff', 20 + i * 60)));

const scene = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  id, tag: 'div', role: 'generic', label: '', boundingBox: { x: 100, y: 100, width: 300, height: 200 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0, interactionType: 'static', isDisabled: false,
  isLoading: false, isFocused: false, visualState: 'normal', children: [], spatialRelationships: [],
  visualConfidence: 1, structuralConfidence: 1, fusionMethod: 'structural_only', ...extra,
} as SceneNode);
const graph = (nodes: SceneNode[]): SceneGraph =>
  ({ timestamp: 0, url: 'http://x', viewport: VP, scrollPosition: { x: 0, y: 0 }, nodes, rootNodeIds: [] });
const snode = (id: string, extra: Partial<StructuralNode> = {}): StructuralNode => ({
  id, tag: 'div', boundingBox: { x: 100, y: 100, width: 300, height: 200 },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
  attributes: {}, states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
  children: [], ...extra,
});
const anim = (extra: Partial<EpisodeAnimation> = {}): EpisodeAnimation =>
  ({ animationId: 'a1', duration: 300, delay: 0, endDelay: 0, iterations: 1, startTs: 1000, ...extra });
const episode = (extra: Partial<Episode> = {}): Episode => ({
  id: 'e1', trigger: { id: 't1', kind: 'action', timestamp: 1000, stateId: 's1' }, startTs: 900, endTs: 1500,
  closeReason: 'settled', animations: [anim()], passive: false, ambientLoop: false, motionOnly: false, ...extra,
});

async function ctx(over: Partial<JunkContext> = {}, nodes: StructuralNode[] = [snode('n1')]): Promise<JunkContext> {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const targets = [nodes[0]];
  return {
    episode: episode(), before: graph([]), after: graph([scene('n1')]), documentStatus: 200,
    frames: await movingFrames(), targets, targetScenes: [scene('n1')], nodeMap: map, pageTitle: 'Home',
    frameSrcs: [], viewport: VP, preRollMs: 100, ...over,
  };
}
const reasonOf = async (c: JunkContext) => { const v = await classifyJunk(c); return v.keep ? 'keep' : v.reason; };

describe('classifyJunk', () => {
  it('rejects_bot_challenge', async () => {
    expect(await reasonOf(await ctx({ pageTitle: 'Just a moment...' }))).toBe('bot-challenge');
    expect(await reasonOf(await ctx({ frameSrcs: ['https://challenges.cloudflare.com/x'] }))).toBe('bot-challenge');
    expect(isBotChallenge(graph([scene('a', { text: 'Verify you are human' })]))).toBe(true);
  });
  it('rejects_error_page', async () => { expect(await reasonOf(await ctx({ documentStatus: 404 }))).toBe('error-page'); });
  it('rejects_login_wall', async () => {
    const after = graph([scene('pw', { interactionType: 'typeable', label: 'Password' })]);
    expect(await reasonOf(await ctx({ after }))).toBe('login-wall');
  });
  it('rejects_blank', async () => {
    const frames = await Promise.all([0, 1].map((i) => solid(i, '#fff')));
    expect(await reasonOf(await ctx({ frames }))).toBe('blank');
  });
  it('rejects_loading', async () => {
    const parent = snode('p', { role: 'progressbar', children: ['n1'] });
    const child = snode('n1', { parent: 'p' });
    expect(await reasonOf(await ctx({}, [child, parent]))).toBe('loading');
  });
  it('rejects_cookie_consent', async () => {
    const parent = snode('p', { attributes: { id: 'onetrust-banner' }, children: ['n1'] });
    expect(await reasonOf(await ctx({}, [snode('n1', { parent: 'p' }), parent]))).toBe('cookie-consent');
  });
  it('rejects_chat_widget', async () => {
    const n = snode('n1', { tag: 'iframe', attributes: { src: 'https://widget.intercom.io/x' } });
    expect(await reasonOf(await ctx({}, [n]))).toBe('chat-widget');
    const fixed = snode('n1', {
      attributes: { class: 'drift-frame' }, boundingBox: { x: 1100, y: 600, width: 150, height: 100 },
      computedStyle: { ...snode('x').computedStyle, position: 'fixed' },
    });
    expect(await reasonOf(await ctx({}, [fixed]))).toBe('chat-widget');
  });
  it('rejects_ad', async () => {
    const n = snode('n1', { tag: 'iframe', attributes: { src: 'https://googleads.g.doubleclick.net/x' } });
    expect(await reasonOf(await ctx({}, [n]))).toBe('ad');
  });
  it('rejects_spinner', async () => {
    const n = snode('n1', { boundingBox: { x: 10, y: 10, width: 40, height: 40 } });
    const c = await ctx({ episode: episode({ animations: [anim({ iterations: Infinity, name: 'spin' })], ambientLoop: true }) }, [n]);
    expect(await reasonOf(c)).toBe('spinner');
  });
  it('rejects_started_mid_animation', async () => {
    const c = await ctx({ episode: episode({ animations: [anim({ startTs: 700 })] }) });
    expect(await reasonOf(c)).toBe('started-mid-animation');
    const passive = await ctx({ episode: episode({ animations: [anim({ startTs: 700 })], passive: true }) });
    expect(await reasonOf(passive)).toBe('keep');
  });
  it('rejects_not_settled', async () => {
    expect(await reasonOf(await ctx({ episode: episode({ closeReason: 'max-duration' }) }))).toBe('not-settled');
    expect(await reasonOf(await ctx({ episode: episode({ closeReason: 'max-duration', ambientLoop: true }) }))).toBe('keep');
  });
  it('rejects_offscreen', async () => {
    const n = snode('n1', { boundingBox: { x: 100, y: 2000, width: 50, height: 50 } });
    expect(await reasonOf(await ctx({}, [n]))).toBe('offscreen');
  });
  it('rejects_covered', async () => {
    expect(await reasonOf(await ctx({ targetScenes: [scene('n1', { visibilityPercent: 10 })] }))).toBe('covered');
  });
  it('rejects_media_playback', async () => {
    expect(await reasonOf(await ctx({}, [snode('n1', { tag: 'video' })]))).toBe('media-playback');
    expect(await reasonOf(await ctx({}, [snode('n1', { tag: 'img', attributes: { src: '/a.gif' } })]))).toBe('media-playback');
  });
  it('rejects_no_motion', async () => {
    const frames = await Promise.all([0, 1, 2].map((i) => solid(i, '#fff', 20)));
    expect(await reasonOf(await ctx({ frames, episode: episode({ animations: [] }) }))).toBe('no-motion');
  });
  it('keeps_clean_modal_open_episode', async () => {
    expect(await classifyJunk(await ctx())).toEqual({ keep: true });
  });
  it('first_matching_rule_wins_challenge_over_blank', async () => {
    const frames = await Promise.all([0, 1].map((i) => solid(i, '#fff')));
    expect(await reasonOf(await ctx({ frames, pageTitle: 'Just a moment' }))).toBe('bot-challenge');
  });
});
