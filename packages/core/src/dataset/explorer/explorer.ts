import type { Engine } from '../../mcp/engine.js';
import { originOf } from '../../mcp/engine.js';
import type { BrowserAction } from '../../types/browser-actions.js';
import type { SceneGraph } from '../../types/scene-graph.js';
import type { RunBudget } from '../budget.js';
import type { Recorder } from '../recorder/recorder.js';
import { isBotChallenge } from '../recorder/junk-filter.js';
import type { SiteMap } from '../sitemap/sitemap.js';
import type { InProcessTools } from '../tools/in-process-tools.js';
import type { TraceWriter } from '../trace/trace-writer.js';
import type { Trigger, TriggerKind } from '../types.js';
import { costUsd, type ExplorerCall, type ExplorerModel, type ExplorerTurn } from './model.js';
import { checkRails } from './rails.js';

export type ExplorerStopReason = 'done' | 'cap-steps' | 'cap-usd' | 'cap-wall' | 'bot-challenge' | 'error';

export interface ExplorerDeps {
  model: ExplorerModel;
  tools: InProcessTools;
  recorder: Recorder;
  siteMap: SiteMap;
  budget: RunBudget;
  trace: TraceWriter;
  engine: Engine;
  startUrl: string;
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const OBSERVATION_MAX = 4_000;
const TRACE_OBSERVATION_MAX = 500;
const SCROLL_STEP_FRACTION = 0.8;
const SCROLL_PAUSE_MS = 1_000;
// ponytail: fixed cap so infinite-scroll pages end; make it per-site if long pages lose coverage
const MAX_SCROLL_STEPS = 25;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const CAP_REASON = { steps: 'cap-steps', usd: 'cap-usd', wall: 'cap-wall' } as const;
const OPEN = '<untrusted_page_content>';
const CLOSE = '</untrusted_page_content>';
const TRUNCATED = '\n...[truncated]';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const count = (s: string, sub: string) => s.split(sub).length - 1;

/** Truncate to max chars, re-closing an envelope the cut left open so page text never reads as outside it. */
export function clipObservation(text: string, max = OBSERVATION_MAX): string {
  if (text.length <= max) return text;
  const tail = `${TRUNCATED}\n${CLOSE}`;
  const cut = text.slice(0, max - tail.length);
  return count(cut, OPEN) > count(cut, CLOSE) ? cut + tail : cut + TRUNCATED;
}

export class Explorer {
  private readonly startOrigin: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly visited = new Set<string>();
  private readonly history: ExplorerTurn['history'] = [];
  private triggerSeq = 0;
  private currentState = '';
  private graph?: SceneGraph;
  private observation = '';

  constructor(private readonly deps: ExplorerDeps) {
    this.startOrigin = originOf(deps.startUrl);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async run(): Promise<{ stopReason: ExplorerStopReason }> {
    const { budget, trace, model } = this.deps;
    try {
      if (await this.openStartPage()) return { stopReason: 'bot-challenge' };
      for (;;) {
        const cap = budget.exceeded();
        if (cap) {
          trace.write({ type: 'cap-hit', step: budget.snapshot().steps, cap });
          return { stopReason: CAP_REASON[cap] };
        }
        const { steps, usd: spent } = budget.snapshot();
        const step = steps + 1;
        const observationSummary = this.observation.slice(0, TRACE_OBSERVATION_MAX);
        const { call, inputTokens, outputTokens } = await model.next({
          observation: this.observation, history: [...this.history], visitedStates: this.visited.size, budget: { steps, usd: spent },
        });
        const usd = costUsd(inputTokens, outputTokens);
        const { summary, finished } = await this.execute(call, step);
        trace.write({
          type: 'explorer-step', step, observationSummary, decision: `${call.tool} ${JSON.stringify(call.args)}`,
          rationale: call.rationale, inputTokens, outputTokens, usd,
        });
        budget.recordStep(usd);
        this.history.push({ call, resultSummary: summary });
        if (finished) return { stopReason: 'done' };
      }
    } catch (e) {
      trace.write({ type: 'error', step: budget.snapshot().steps, message: `explorer: ${errMessage(e)}` });
      return { stopReason: 'error' };
    }
  }

  /** Explorer-driven, not a model step. Returns true when the start page is a bot challenge. */
  private async openStartPage(): Promise<boolean> {
    const { recorder, tools, engine, startUrl } = this.deps;
    await recorder.beginTrigger(this.trigger('page-load', ''));
    await tools.call('navigate', { url: startUrl });
    await recorder.awaitSettle();
    const graph = await engine.captureGraph(false);
    const page = engine.runtime.getPage();
    if (isBotChallenge(graph, await page.title().catch(() => ''), page.frames().map((f) => f.url()))) return true;
    const state = this.deps.siteMap.observe(graph.url, graph, 0);
    this.graph = graph;
    this.currentState = state.id;
    this.visited.add(state.id);
    await this.scrollSweep();
    this.observation = await this.buildObservation();
    return false;
  }

  private async execute(call: ExplorerCall, step: number): Promise<{ summary: string; finished: boolean }> {
    const verdict = checkRails(call, { startOrigin: this.startOrigin, targetLabel: this.labelAt(call) });
    if (!verdict.ok) {
      this.deps.trace.write({ type: 'tool-refused', step, tool: String(call.tool), detail: verdict.reason });
      return { summary: `refused: ${verdict.reason}`, finished: false };
    }
    if (call.tool === 'done') return { summary: 'done', finished: true };
    if (call.tool === 'get_scene' || call.tool === 'get_affordances') {
      const res = await this.deps.tools.call(call.tool, call.args);
      this.observation = clipObservation(res.text);
      return { summary: res.isError ? 'error' : 'ok', finished: false };
    }
    return { summary: await this.runAction(call, step), finished: false };
  }

  private async runAction(call: ExplorerCall, step: number): Promise<string> {
    const { recorder, tools, engine, siteMap } = this.deps;
    const { target: _target, ...actArgs } = call.args;
    const action = (call.tool === 'navigate' ? { type: 'navigate', url: call.args.url } : actArgs) as BrowserAction;
    const trigger = { ...this.trigger('action', this.currentState), action };
    await recorder.beginTrigger(trigger);
    const res = await tools.call(call.tool, call.tool === 'navigate' ? { url: call.args.url } : actArgs);
    await recorder.awaitSettle();

    const graph = await engine.captureGraph(false);
    const state = siteMap.observe(graph.url, graph, step);
    siteMap.addTransition({ from: this.currentState, to: state.id, action, triggerId: trigger.id, clipIds: [] });
    this.graph = graph;
    this.currentState = state.id;
    const isNew = !this.visited.has(state.id);
    if (isNew) {
      this.visited.add(state.id);
      await recorder.beginTrigger(this.trigger('page-load', state.id));
      await recorder.awaitSettle();
      await this.scrollSweep();
    }
    this.observation = await this.buildObservation();
    return `${res.isError ? 'error' : 'ok'}; state ${state.id}${isNew ? ' (new)' : ''}`;
  }

  private async scrollSweep(): Promise<void> {
    const { engine, recorder, budget } = this.deps;
    const page = engine.runtime.getPage();
    const stepPx = Math.round(SCROLL_STEP_FRACTION * (page.viewportSize()?.height ?? DEFAULT_VIEWPORT_HEIGHT));
    const height = (await page.evaluate(() => document.documentElement.scrollHeight)) as number;
    for (let k = 1; k <= MAX_SCROLL_STEPS && k * stepPx < height && !budget.exceeded(); k++) {
      const y = k * stepPx;
      await recorder.beginTrigger({ ...this.trigger('scroll-step', this.currentState), scrollY: y });
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await this.sleep(SCROLL_PAUSE_MS);
      await recorder.awaitSettle();
    }
    await page.evaluate((top) => window.scrollTo(0, top), 0);
  }

  private async buildObservation(): Promise<string> {
    const { tools } = this.deps;
    const affordances = await tools.call('get_affordances', {});
    const scene = await tools.call('get_scene', {});
    return clipObservation(`Affordances:\n${affordances.text}\n\nScene:\n${scene.text}`);
  }

  /** Smallest scene node under a coordinate click, so rails judge the real target, not the model's claim. */
  private labelAt(call: ExplorerCall): string | undefined {
    const { x, y, type } = call.args;
    if (call.tool !== 'act' || type !== 'click' || typeof x !== 'number' || typeof y !== 'number' || !this.graph) return undefined;
    const hits = this.graph.nodes.filter(({ boundingBox: b }) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
    const area = (n: SceneGraph['nodes'][number]) => n.boundingBox.width * n.boundingBox.height;
    const hit = hits.sort((a, b) => area(a) - area(b))[0];
    // Fused `label` is a role/detection class ('button'); visible text lives in `text` / `imageAlt`.
    return hit ? [hit.text, hit.imageAlt, hit.label].filter(Boolean).join(' ') || undefined : undefined;
  }

  private trigger(kind: TriggerKind, stateId: string): Trigger {
    return { id: `trg-${String(++this.triggerSeq).padStart(4, '0')}`, kind, timestamp: Date.now(), stateId };
  }
}
