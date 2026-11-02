import { actInputSchema } from '../../mcp/act-schema.js';
import type { ExplorerCall } from './model.js';

export type RailVerdict = { ok: true } | { ok: false; reason: string };
export interface RailContext {
  startOrigin: string;
  /** Label of the scene node under a click, resolved by the explorer rather than trusted from the model. */
  targetLabel?: string;
}

const KNOWN_TOOLS = new Set(['navigate', 'act', 'get_scene', 'get_affordances', 'done']);
const BANNED_ACTS = new Set(['type', 'setViewport']);
const RISKY_LABEL = /sign ?in|log ?in|sign ?up|register|buy|checkout|subscribe|pay|delete|remove|submit|send/i;
const OK: RailVerdict = { ok: true };
const refuse = (reason: string): RailVerdict => ({ ok: false, reason });

function originCheck(url: unknown, startOrigin: string): RailVerdict {
  if (typeof url !== 'string') return refuse('navigate without a url');
  try {
    const origin = new URL(url).origin;
    return origin === startOrigin ? OK : refuse(`off-origin url ${origin}`);
  } catch {
    return refuse('unparseable url');
  }
}

export function checkRails(call: ExplorerCall, ctx: RailContext): RailVerdict {
  if (!KNOWN_TOOLS.has(call.tool)) return refuse(`unknown tool ${call.tool}`);
  if (call.tool === 'navigate') return originCheck(call.args.url, ctx.startOrigin);
  if (call.tool !== 'act') return OK;

  const parsed = actInputSchema.safeParse(call.args);
  if (!parsed.success) return refuse(`invalid act arguments: ${parsed.error.issues[0]?.message ?? 'schema'}`);
  const a = parsed.data;
  if (BANNED_ACTS.has(a.type)) return refuse(`act ${a.type} is not allowed`);
  // Enter submits forms; other keys (Escape, Tab, arrows) drive close/focus animations.
  if (a.type === 'pressKey' && /enter/i.test(a.key ?? '')) return refuse('pressKey Enter is not allowed');
  if (a.type === 'navigate') return originCheck(a.url, ctx.startOrigin);
  if (a.type === 'click' || a.type === 'clickSelector') {
    const labels = [call.args.target, a.selector, ctx.targetLabel].filter((s): s is string => typeof s === 'string');
    const risky = labels.find((l) => RISKY_LABEL.test(l));
    if (risky !== undefined) return refuse(`click target looks risky: ${risky.slice(0, 80)}`);
  }
  return OK;
}
