import { describe, it, expect, vi } from 'vitest';
import { Explorer } from '../../../../src/dataset/explorer/explorer.js';
import type { ExplorerCall, ExplorerModel } from '../../../../src/dataset/explorer/model.js';
import { RunBudget, DEFAULT_CAPS, type BudgetCaps } from '../../../../src/dataset/budget.js';
import { SiteMap } from '../../../../src/dataset/sitemap/sitemap.js';
import type { TraceInput } from '../../../../src/dataset/trace/trace-writer.js';
import type { Trigger } from '../../../../src/dataset/types.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/scene-graph.js';

const START = 'https://site.test/';
const VP = { width: 1280, height: 720 };

const node = (id: string, label: string, box = { x: 0, y: 0, width: 10, height: 10 }): SceneNode => ({
  id, tag: 'button', role: 'button', label, boundingBox: box, viewportPosition: 'visible', visibilityPercent: 100,
  zLayer: 0, interactionType: 'clickable', isDisabled: false, isLoading: false, isFocused: false, visualState: 'normal', children: [],
} as unknown as SceneNode);

function harness(script: ExplorerCall[], opts: { caps?: Partial<BudgetCaps>; tokens?: [number, number]; nodes?: SceneNode[] } = {}) {
  let url = START;
  const records: TraceInput[] = [];
  const triggers: Trigger[] = [];
  const scrolls: number[] = [];
  const turns: unknown[] = [];
  let i = 0;
  const model: ExplorerModel = {
    next: vi.fn(async (turn) => {
      turns.push(turn);
      const call = script[Math.min(i++, script.length - 1)];
      return { call, inputTokens: opts.tokens?.[0] ?? 100, outputTokens: opts.tokens?.[1] ?? 10 };
    }),
  };
  const tools = {
    call: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'navigate') url = String(args.url);
      if (name === 'act' && args.type === 'navigate') url = String(args.url);
      return { text: name === 'get_scene' ? '<untrusted_page_content>\nscene\n</untrusted_page_content>' : `${name} ok`, isError: false };
    }),
  };
  const recorder = {
    beginTrigger: vi.fn(async (t: Trigger) => { triggers.push(t); }),
    awaitSettle: vi.fn(async () => []),
  };
  const page = {
    evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {
      if (typeof arg === 'number') { scrolls.push(arg); return undefined; }
      return 1440; // document scroll height
    }),
    viewportSize: () => VP,
    title: async () => 'Site',
    frames: () => [],
  };
  const graph = (): SceneGraph => ({ timestamp: 0, url, viewport: VP, scrollPosition: { x: 0, y: 0 }, nodes: opts.nodes ?? [], rootNodeIds: [] });
  const engine = { captureGraph: vi.fn(async () => graph()), runtime: { getPage: () => page } };
  const budget = new RunBudget({ ...DEFAULT_CAPS, ...opts.caps });
  const explorer = new Explorer({
    model, tools: tools as never, recorder: recorder as never, siteMap: new SiteMap('site.test', START), budget,
    trace: { write: (r: TraceInput) => { records.push(r); return `t${records.length}`; } } as never,
    engine: engine as never, startUrl: START, sleep: async () => undefined,
  });
  return { explorer, records, triggers, scrolls, turns, tools, budget };
}

const act = (args: Record<string, unknown>, rationale = 'r'): ExplorerCall => ({ tool: 'act', args, rationale });
const done: ExplorerCall = { tool: 'done', args: {}, rationale: 'finished' };

describe('Explorer', () => {
  it('refuses_off_rail_tool_calls_and_counts_step', async () => {
    const h = harness([
      { tool: 'navigate', args: { url: 'https://evil.test/' }, rationale: 'r' },
      act({ type: 'click', x: 5, y: 5, target: 'Buy now' }),
      { tool: 'get_screenshot', args: {}, rationale: 'r' } as unknown as ExplorerCall,
      act({ type: 'wait', ms: 'forever' }),
      done,
    ]);

    const { stopReason } = await h.explorer.run();

    expect(stopReason).toBe('done');
    const refusedTools = h.records.filter((r) => r.type === 'tool-refused').map((r) => (r as { tool: string }).tool);
    expect(refusedTools).toEqual(['navigate', 'act', 'get_screenshot', 'act']);
    expect(h.budget.snapshot().steps).toBe(5);
    expect(h.tools.call.mock.calls.filter(([n]) => n === 'act')).toHaveLength(0);
    expect(h.tools.call.mock.calls.filter(([n, a]) => n === 'navigate' && a.url !== START)).toHaveLength(0);
  });

  it('refuses a click whose resolved scene label is risky even when the model mislabels it', async () => {
    const h = harness([act({ type: 'click', x: 5, y: 5, target: 'Nice card' }), done], { nodes: [node('n1', 'Delete account')] });
    await h.explorer.run();
    expect(h.records.some((r) => r.type === 'tool-refused')).toBe(true);
    expect(h.tools.call.mock.calls.filter(([n]) => n === 'act')).toHaveLength(0);
  });

  it('stops_at_step_cap_with_cap_hit_trace', async () => {
    const h = harness([{ tool: 'get_scene', args: {}, rationale: 'look' }], { caps: { maxSteps: 3 } });
    const { stopReason } = await h.explorer.run();
    expect(stopReason).toBe('cap-steps');
    expect(h.budget.snapshot().steps).toBe(3);
    expect(h.records.filter((r) => r.type === 'explorer-step')).toHaveLength(3);
    expect(h.records.at(-1)).toMatchObject({ type: 'cap-hit', cap: 'steps' });
  });

  it('stops_at_usd_cap', async () => {
    // 100k in + 10k out at 3/15 per Mtok = $0.45 per step
    const h = harness([{ tool: 'get_scene', args: {}, rationale: 'look' }], { caps: { maxUsd: 1 }, tokens: [100_000, 10_000] });
    const { stopReason } = await h.explorer.run();
    expect(stopReason).toBe('cap-usd');
    expect(h.budget.snapshot().steps).toBe(3);
    const step = h.records.find((r) => r.type === 'explorer-step') as { usd: number; inputTokens: number };
    expect(step.usd).toBeCloseTo(0.45);
    expect(step.inputTokens).toBe(100_000);
    expect(h.records.at(-1)).toMatchObject({ type: 'cap-hit', cap: 'usd' });
  });

  it('scroll_sweep_runs_once_per_new_state', async () => {
    const h = harness([
      { tool: 'navigate', args: { url: 'https://site.test/a' }, rationale: 'new page' },
      act({ type: 'hover', x: 1, y: 1, target: 'Menu' }), // same state
      { tool: 'navigate', args: { url: START }, rationale: 'revisit' },
      done,
    ]);

    await h.explorer.run();

    const pageLoads = h.triggers.filter((t) => t.kind === 'page-load');
    const scrollSteps = h.triggers.filter((t) => t.kind === 'scroll-step');
    expect(pageLoads).toHaveLength(2); // start page + /a
    // 1440px page, 0.8 * 720 = 576px steps: y = 576, 1152 per state
    expect(scrollSteps.map((t) => t.scrollY)).toEqual([576, 1152, 576, 1152]);
    expect(h.scrolls).toEqual([576, 1152, 0, 576, 1152, 0]);
    expect(h.triggers.filter((t) => t.kind === 'action')).toHaveLength(3);
    expect(h.budget.snapshot().steps).toBe(4); // sweeps are not model steps
  });

  it('records the action trigger before the tool runs and adds the site-map transition', async () => {
    const h = harness([act({ type: 'navigate', url: 'https://site.test/b' }), done]);
    await h.explorer.run();
    const actionTrigger = h.triggers.find((t) => t.kind === 'action')!;
    expect(actionTrigger.action).toEqual({ type: 'navigate', url: 'https://site.test/b' });
    const json = (h.explorer as unknown as { deps: { siteMap: SiteMap } }).deps.siteMap.toJSON();
    expect(json.states).toHaveLength(2);
    expect(json.transitions).toEqual([expect.objectContaining({ from: json.states[0].id, to: json.states[1].id, triggerId: actionTrigger.id })]);
  });

  it('done_call_ends_run', async () => {
    const h = harness([done, { tool: 'get_scene', args: {}, rationale: 'never' }]);
    const { stopReason } = await h.explorer.run();
    expect(stopReason).toBe('done');
    expect(h.turns).toHaveLength(1);
    expect(h.records.filter((r) => r.type === 'explorer-step')).toHaveLength(1);
  });

  it('keeps observations within 4,000 characters and the untrusted envelope closed', async () => {
    const h = harness([done]);
    h.tools.call.mockImplementation(async (name: string) => ({
      text: name === 'get_scene' ? `<untrusted_page_content>\n${'x'.repeat(10_000)}\n</untrusted_page_content>` : 'aff',
      isError: false,
    }));
    await h.explorer.run();
    const obs = (h.turns[0] as { observation: string }).observation;
    expect(obs.length).toBeLessThanOrEqual(4_000);
    expect(obs.trimEnd().endsWith('</untrusted_page_content>')).toBe(true);
  });

  it('returns error when the model throws', async () => {
    const h = harness([done]);
    (h.explorer as unknown as { deps: { model: ExplorerModel } }).deps.model.next = async () => { throw new Error('api down'); };
    const { stopReason } = await h.explorer.run();
    expect(stopReason).toBe('error');
    expect(h.records.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('api down') });
  });
});
