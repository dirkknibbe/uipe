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
  /** clip ids recorded before the explorer adds their trigger's transition */
  private pendingClips = new Map<string, string[]>();

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
    const pending = this.pendingClips.get(t.triggerId) ?? [];
    this.pendingClips.delete(t.triggerId);
    this.transitions.push({ ...t, clipIds: [...t.clipIds, ...pending] });
  }

  /** The recorder keeps clips before the explorer records the transition, so either order works. */
  addClip(triggerId: string, clipId: string): void {
    const i = this.transitions.findIndex((t) => t.triggerId === triggerId);
    if (i >= 0) {
      const t = this.transitions[i];
      this.transitions[i] = { ...t, clipIds: [...t.clipIds, clipId] };
      return;
    }
    this.pendingClips.set(triggerId, [...(this.pendingClips.get(triggerId) ?? []), clipId]);
  }

  /** The URL the start page landed on (after any same-site redirect); pathTo() starts there. */
  get startStateUrl(): string {
    return (this.states.values().next().value as SiteState | undefined)?.url ?? this.startUrl;
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
