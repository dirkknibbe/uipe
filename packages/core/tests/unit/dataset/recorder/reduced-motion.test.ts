import { describe, it, expect, vi } from 'vitest';
import { replayReducedMotion } from '../../../../src/dataset/recorder/reduced-motion.js';
import { SiteMap } from '../../../../src/dataset/sitemap/sitemap.js';
import type { Trigger } from '../../../../src/dataset/types.js';

function fakePage(failOn?: string) {
  const calls: string[] = [];
  const page: any = {
    emulateMedia: vi.fn(async (o: any) => { calls.push(`media:${o.reducedMotion}`); }),
    goto: vi.fn(async () => { calls.push('goto'); if (failOn === 'goto') throw new Error('boom'); }),
    waitForTimeout: vi.fn(async () => undefined),
    mouse: { click: vi.fn(async () => { calls.push('click'); }), move: vi.fn(), wheel: vi.fn() },
    evaluate: vi.fn(), reload: vi.fn(),
  };
  return { page, calls };
}
const recorder: any = { dropBefore: vi.fn(), framesBetween: vi.fn(() => []) };
const trigger = (action: Trigger['action']): Trigger => ({ id: 't', kind: 'action', timestamp: 0, stateId: 's', action });
const base = { recorder, settleMs: 0, normalMotion: 1 };

describe('replayReducedMotion', () => {
  it('replay_restores_media_emulation_even_on_error', async () => {
    const { page, calls } = fakePage('goto');
    const sm = new SiteMap('x', 'https://x.test/');
    const s = sm.observe('https://x.test/', { url: 'https://x.test/', nodes: [] } as any, 0);
    const r = await replayReducedMotion({ ...base, page, siteMap: sm, stateId: s.id, trigger: trigger({ type: 'click', x: 1, y: 1 }) });
    expect(r).toEqual({ status: 'not-reproducible', reason: 'error' });
    expect(calls[0]).toBe('media:reduce');
    expect(calls.at(-1)).toBe('media:null');
  });

  it('replay_returns_not_reproducible_when_path_null', async () => {
    const { page } = fakePage();
    const sm = new SiteMap('x', 'https://x.test/');
    sm.observe('https://x.test/', { url: 'https://x.test/', nodes: [] } as any, 0);
    const r = await replayReducedMotion({ ...base, page, siteMap: sm, stateId: 'nope', trigger: trigger({ type: 'click', x: 1, y: 1 }) });
    expect(r).toEqual({ status: 'not-reproducible', reason: 'unreachable-state' });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('typing_trigger_is_side_effect_risk_and_not_replayed', async () => {
    const { page } = fakePage();
    const sm = new SiteMap('x', 'https://x.test/');
    const s = sm.observe('https://x.test/', { url: 'https://x.test/', nodes: [] } as any, 0);
    for (const action of [{ type: 'type' as const, text: 'hi' }, { type: 'pressKey' as const, key: 'Enter' }]) {
      const r = await replayReducedMotion({ ...base, page, siteMap: sm, stateId: s.id, trigger: trigger(action) });
      expect(r).toEqual({ status: 'not-reproducible', reason: 'side-effect-risk' });
    }
    expect(page.emulateMedia).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });
});
