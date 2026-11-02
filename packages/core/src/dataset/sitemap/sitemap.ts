import { createHash } from 'node:crypto';
import type { BrowserAction } from '../../types/browser-actions.js';
import type { SceneGraph } from '../../types/scene-graph.js';

export interface SiteState { id: string; url: string; structureSignature: string; firstSeenStep: number }
export interface SiteTransition { from: string; to: string; action: BrowserAction; triggerId: string; clipIds: string[] }
export interface SiteMapJSON { version: 1; site: string; startUrl: string; states: SiteState[]; transitions: SiteTransition[] }

const TOP_NODES = 50;

function signature(graph: SceneGraph): string {
  return graph.nodes
    .filter((n) => n.interactionType !== 'static')
    .map((n) => `${n.role}:${n.label}`)
    .sort()
    .slice(0, TOP_NODES)
    .join('|');
}

export class SiteMap {
  private states = new Map<string, SiteState>();
  private transitions: SiteTransition[] = [];

  constructor(readonly site: string, readonly startUrl: string) {}

  static stateIdFor(url: string, graph: SceneGraph): string {
    return createHash('sha256').update(`${url.split('#')[0]}\n${signature(graph)}`).digest('hex').slice(0, 16);
  }

  observe(url: string, graph: SceneGraph, step: number): SiteState {
    const id = SiteMap.stateIdFor(url, graph);
    const existing = this.states.get(id);
    if (existing) return existing;
    const state = { id, url, structureSignature: signature(graph), firstSeenStep: step };
    this.states.set(id, state);
    return state;
  }

  addTransition(t: SiteTransition): void {
    this.transitions.push(t);
  }

  /** BFS from the first observed state (the start page). */
  pathTo(stateId: string): BrowserAction[] | null {
    const start = this.states.values().next().value as SiteState | undefined;
    if (!start || !this.states.has(stateId)) return null;
    const paths = new Map<string, BrowserAction[]>([[start.id, []]]);
    const queue = [start.id];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (id === stateId) return paths.get(id)!;
      for (const t of this.transitions) {
        if (t.from !== id || paths.has(t.to)) continue;
        paths.set(t.to, [...paths.get(id)!, t.action]);
        queue.push(t.to);
      }
    }
    return null;
  }

  toJSON(): SiteMapJSON {
    return { version: 1, site: this.site, startUrl: this.startUrl, states: [...this.states.values()], transitions: this.transitions };
  }

  static fromJSON(j: SiteMapJSON): SiteMap {
    const m = new SiteMap(j.site, j.startUrl);
    for (const s of j.states) m.states.set(s.id, s);
    m.transitions = [...j.transitions];
    return m;
  }
}
