import sharp from 'sharp';
import type { SceneGraph, SceneNode } from '../../types/scene-graph.js';
import type { StructuralNode } from '../../types/structural.js';
import type { CapturedFrame } from '../capture/screencast-recorder.js';
import type { Episode, RejectReason } from '../types.js';
import { measuredDuration } from './measure.js';

export interface JunkContext {
  episode: Episode;
  before: SceneGraph;
  after: SceneGraph;
  documentStatus: number | null;
  frames: CapturedFrame[];
  /** structural nodes joined via data-uipe-anim */
  targets: StructuralNode[];
  /** same ids as targets, from the after graph (ruling R6) */
  targetScenes: SceneNode[];
  nodeMap: ReadonlyMap<string, StructuralNode>;
  pageTitle: string;
  frameSrcs: string[];
  viewport: { width: number; height: number };
  /** segmenter pre-roll, default 100 (ruling R4) */
  preRollMs: number;
}
export type JunkVerdict = { keep: true } | { keep: false; reason: RejectReason; detail: string };

const CHALLENGE_TEXT = /just a moment|checking your browser|verify you are human|captcha/i;
const CHALLENGE_SRC = /challenges\.cloudflare\.com|hcaptcha|recaptcha/i;
const COOKIE = /cookie|consent|gdpr|onetrust|cmp/i;
const CHAT = /intercom|drift|zendesk|crisp|hubspot|livechat|tawk/i;
const AD = /doubleclick|googlesyndication|adservice|taboola|outbrain/i;
const SPINNER_NAME = /spin|rotat|loader|loading/i;
const BLANK_STDDEV = 2;
const LOGIN_MIN_VISIBLE = 50;
const LOGIN_MAIN_TEXT = 120; // another node with this much text counts as "other main content"
const COOKIE_MAX_TEXT = 200; // ancestors' text (body) contains everything; only short text is evidence
const SPINNER_MAX_PX = 80;
const COVERED_BELOW = 50;
const CORNER_PX = 150;

function sceneTexts(g: SceneGraph): string[] {
  return g.nodes.flatMap((n) => [n.text, n.label].filter((s): s is string => !!s));
}

export function isBotChallenge(graph: SceneGraph, pageTitle = '', frameSrcs: string[] = []): boolean {
  return CHALLENGE_TEXT.test(pageTitle)
    || sceneTexts(graph).some((t) => CHALLENGE_TEXT.test(t))
    || frameSrcs.some((s) => CHALLENGE_SRC.test(s));
}

function isLoginWall(g: SceneGraph): boolean {
  const pw = g.nodes.find((n) => n.interactionType === 'typeable' && n.visibilityPercent >= LOGIN_MIN_VISIBLE
    && /password/i.test(`${n.label} ${n.placeholder ?? ''} ${n.role}`));
  if (!pw) return false;
  return !g.nodes.some((n) => n.id !== pw.id && (n.text?.length ?? 0) >= LOGIN_MAIN_TEXT);
}

async function isBlank(frames: CapturedFrame[]): Promise<boolean> {
  if (frames.length === 0) return false;
  for (const f of frames) {
    const { channels } = await sharp(f.jpeg).greyscale().stats();
    if (channels[0].stdev >= BLANK_STDDEV) return false;
  }
  return true;
}

function chain(t: StructuralNode, map: ReadonlyMap<string, StructuralNode>): StructuralNode[] {
  const out: StructuralNode[] = [];
  const seen = new Set<string>();
  for (let n: StructuralNode | undefined = t; n && !seen.has(n.id); n = n.parent ? map.get(n.parent) : undefined) {
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

const idClass = (n: StructuralNode) => `${n.attributes.id ?? ''} ${n.attributes.class ?? ''}`;
const anyTarget = (ctx: JunkContext, pred: (n: StructuralNode) => boolean) =>
  ctx.targets.some((t) => chain(t, ctx.nodeMap).some(pred));

function isLoadingNode(n: StructuralNode, scene?: SceneNode): boolean {
  return !!scene?.isLoading || n.role === 'progressbar' || n.attributes['aria-busy'] === 'true';
}

function isCookie(n: StructuralNode): boolean {
  const short = n.text && n.text.length <= COOKIE_MAX_TEXT ? n.text : '';
  return COOKIE.test(`${n.name ?? ''} ${short} ${idClass(n)}`);
}

function isBottomCornerFixed(n: StructuralNode, vp: { width: number; height: number }): boolean {
  if (n.computedStyle.position !== 'fixed') return false;
  const b = n.boundingBox;
  const nearBottom = b.y + b.height >= vp.height - CORNER_PX;
  const nearSide = b.x <= CORNER_PX || b.x + b.width >= vp.width - CORNER_PX;
  return nearBottom && nearSide;
}

function isChat(n: StructuralNode, vp: { width: number; height: number }): boolean {
  const hay = `${idClass(n)} ${n.attributes.src ?? ''}`;
  return CHAT.test(hay) && (n.tag === 'iframe' || isBottomCornerFixed(n, vp));
}

function isInfiniteSpinner(ctx: JunkContext): boolean {
  const small = ctx.targets.some((t) => t.boundingBox.width <= SPINNER_MAX_PX && t.boundingBox.height <= SPINNER_MAX_PX);
  return small && ctx.episode.animations.some((a) => a.iterations === Infinity && SPINNER_NAME.test(a.name ?? ''));
}

function isOffscreen(t: StructuralNode, vp: { width: number; height: number }): boolean {
  const b = t.boundingBox;
  return b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= vp.width || b.y >= vp.height;
}

const reject = (reason: RejectReason, detail: string): JunkVerdict => ({ keep: false, reason, detail });

/** First matching rule wins; async because blank / no-motion decode frames. */
export async function classifyJunk(ctx: JunkContext): Promise<JunkVerdict> {
  const { episode: ep, targets, viewport: vp } = ctx;
  if (isBotChallenge(ctx.after, ctx.pageTitle, ctx.frameSrcs)) return reject('bot-challenge', 'challenge text or frame');
  if (ctx.documentStatus !== null && ctx.documentStatus >= 400) return reject('error-page', `status ${ctx.documentStatus}`);
  if (isLoginWall(ctx.after)) return reject('login-wall', 'password field with no other main content');
  if (await isBlank(ctx.frames)) return reject('blank', 'every frame luminance stddev < 2');

  const sceneById = new Map(ctx.targetScenes.map((s) => [s.id, s]));
  if (targets.some((t) => chain(t, ctx.nodeMap).some((n) => isLoadingNode(n, sceneById.get(n.id))))) {
    return reject('loading', 'target or ancestor is loading');
  }
  if (anyTarget(ctx, isCookie)) return reject('cookie-consent', 'target or ancestor matches consent pattern');
  if (anyTarget(ctx, (n) => isChat(n, vp))) return reject('chat-widget', 'target inside chat widget');
  if (anyTarget(ctx, (n) => n.tag === 'iframe' && AD.test(n.attributes.src ?? ''))) return reject('ad', 'target inside ad iframe');
  if (isInfiniteSpinner(ctx)) return reject('spinner', 'infinite rotate on small target');

  const cutoff = ep.trigger.timestamp - ctx.preRollMs;
  if (!ep.passive && ep.animations.some((a) => a.startTs < cutoff)) {
    return reject('started-mid-animation', 'animation began before trigger pre-roll');
  }
  if (ep.closeReason === 'max-duration' && !ep.ambientLoop) return reject('not-settled', 'hit max duration');
  if (targets.length > 0 && targets.every((t) => isOffscreen(t, vp))) return reject('offscreen', 'all targets outside viewport');
  if (ctx.targetScenes.length > 0 && ctx.targetScenes.every((s) => s.visibilityPercent < COVERED_BELOW)) {
    return reject('covered', 'all targets < 50% visible');
  }
  if (targets.length > 0 && targets.every((t) => t.tag === 'video' || (t.tag === 'img' && /\.gif(\?|#|$)/i.test(t.attributes.src ?? '')))) {
    return reject('media-playback', 'targets are video or gif');
  }
  if (ep.animations.length === 0 && (await measuredDuration(ctx.frames)) === null) return reject('no-motion', 'no animations and no visible change');
  return { keep: true };
}
