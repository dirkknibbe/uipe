import { describe, it, expect } from 'vitest';
import { SiteMap } from '../../../../src/dataset/sitemap/sitemap.js';
import type { SceneGraph, SceneNode } from '../../../../src/types/scene-graph.js';

const node = (id: string, label: string, role = 'button'): SceneNode => ({ id, label, role, interactionType: 'clickable' } as SceneNode);
const graph = (url: string, nodes: SceneNode[]): SceneGraph => ({ url, nodes } as SceneGraph);
const click = (n: number) => ({ type: 'click' as const, x: n, y: n });

describe('SiteMap', () => {
  it('state_id_stable_across_reordered_dom_ids', () => {
    const a = graph('https://x.test/a#top', [node('dom-1', 'Buy'), node('dom-2', 'Menu')]);
    const b = graph('https://x.test/a', [node('dom-9', 'Menu'), node('dom-3', 'Buy')]);
    expect(SiteMap.stateIdFor(a.url, a)).toBe(SiteMap.stateIdFor(b.url, b));
    expect(SiteMap.stateIdFor(a.url, a)).toMatch(/^[0-9a-f]{16}$/);
    expect(SiteMap.stateIdFor('https://x.test/b', a)).not.toBe(SiteMap.stateIdFor(a.url, a));
  });

  function built() {
    const m = new SiteMap('x.test', 'https://x.test/');
    const s0 = m.observe('https://x.test/', graph('https://x.test/', [node('1', 'Home')]), 0);
    const s1 = m.observe('https://x.test/a', graph('https://x.test/a', [node('1', 'A')]), 1);
    const s2 = m.observe('https://x.test/b', graph('https://x.test/b', [node('1', 'B')]), 2);
    const s3 = m.observe('https://x.test/c', graph('https://x.test/c', [node('1', 'C')]), 3);
    m.addTransition({ from: s0.id, to: s1.id, action: click(1), triggerId: 't1', clipIds: [] });
    m.addTransition({ from: s1.id, to: s3.id, action: click(2), triggerId: 't2', clipIds: [] });
    m.addTransition({ from: s0.id, to: s2.id, action: click(3), triggerId: 't3', clipIds: [] });
    m.addTransition({ from: s2.id, to: s3.id, action: click(4), triggerId: 't4', clipIds: [] });
    return { m, s0, s1, s2, s3 };
  }

  it('path_to_returns_shortest_action_sequence', () => {
    const { m, s0, s3 } = built();
    expect(m.pathTo(s0.id)).toEqual([]);
    expect(m.pathTo(s3.id)).toHaveLength(2);
  });

  it('path_to_unreachable_returns_null', () => {
    const { m } = built();
    const island = m.observe('https://x.test/island', graph('https://x.test/island', [node('1', 'Island')]), 9);
    expect(m.pathTo(island.id)).toBeNull();
  });

  it('sitemap_json_round_trips_with_version_1', () => {
    const { m, s3 } = built();
    const json = JSON.parse(JSON.stringify(m.toJSON()));
    expect(json.version).toBe(1);
    const back = SiteMap.fromJSON(json);
    expect(back.toJSON()).toEqual(json);
    expect(back.pathTo(s3.id)).toEqual(m.pathTo(s3.id));
  });

  it('add_clip_attaches_to_transition_in_either_order', () => {
    const m = new SiteMap('x', 'https://x.test/');
    m.addClip('t1', 'clip-0001');
    m.addTransition({ from: 'a', to: 'b', action: click(1), triggerId: 't1', clipIds: [] });
    m.addClip('t1', 'clip-0002');
    m.addClip('t2', 'clip-0003');
    expect(m.toJSON().transitions).toEqual([{ from: 'a', to: 'b', action: click(1), triggerId: 't1', clipIds: ['clip-0001', 'clip-0002'] }]);
  });
});
