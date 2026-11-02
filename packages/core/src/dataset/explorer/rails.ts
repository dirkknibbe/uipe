import { actInputSchema } from '../../mcp/act-schema.js';
import type { ExplorerCall } from './model.js';

/** `reason` reaches the model, so it names the rule only; `detail` (may hold page text) is trace-only. */
export type RailVerdict = { ok: true } | { ok: false; reason: string; detail?: string };
export interface RailContext {
  startOrigin: string;
  /** Label of the clickable element a click resolves to in the page, never the model's claim. */
  targetLabel?: string;
  /** The resolved click target is a form submit control. */
  targetSubmit?: boolean;
}

const KNOWN_TOOLS = new Set(['navigate', 'act', 'get_scene', 'get_affordances', 'done']);
const BANNED_ACTS = new Set(['type', 'setViewport']);
// Newer stems match at a word start only, so 'border' is not an order. Denylist, not the only guard:
// unresolved/empty labels and submit controls are refused regardless of text.
const RISKY_LABEL =
  /sign ?in|log ?in|sign ?up|register|buy|checkout|subscribe|pay|delete|remove|submit|send|\b(?:order|cart|donate|upgrade|trial|join|unsubscribe|confirm|post|comment|publish)/i;
// Keys that drive focus/close/scroll animations; Space and printable keys can activate a focused submit.
const ALLOWED_KEYS = new Set([
  'Escape', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
]);
const OK: RailVerdict = { ok: true };
const refuse = (reason: string, detail?: string): RailVerdict => ({ ok: false, reason, ...(detail ? { detail } : {}) });

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
  if (a.type === 'pressKey' && !ALLOWED_KEYS.has(a.key ?? '')) return refuse('pressKey key is not on the allowlist', a.key);
  if (a.type === 'navigate') return originCheck(a.url, ctx.startOrigin);
  if (a.type === 'click' || a.type === 'clickSelector') {
    if (!ctx.targetLabel?.trim()) return refuse('click target could not be resolved to a labelled element');
    if (ctx.targetSubmit) return refuse('click target is a form submit control', ctx.targetLabel.slice(0, 200));
    const labels = [call.args.target, a.selector, ctx.targetLabel].filter((s): s is string => typeof s === 'string');
    const risky = labels.find((l) => RISKY_LABEL.test(l));
    if (risky !== undefined) return refuse('click target label is risky', risky.slice(0, 200));
  }
  return OK;
}
