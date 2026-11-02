import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { episodeFingerprint, framesPHash, DedupIndex } from '../../../../src/dataset/recorder/dedup.js';
import type { StructuralNode } from '../../../../src/types/structural.js';
import type { Episode, EpisodeAnimation } from '../../../../src/dataset/types.js';

const snode = (id: string, cls = 'nav'): StructuralNode => ({
  id, tag: 'div', boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
  attributes: { class: cls }, states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
  children: [],
});
const anim = (extra: Partial<EpisodeAnimation> = {}): EpisodeAnimation =>
  ({ animationId: 'a1', name: 'slide', duration: 300, delay: 0, endDelay: 0, iterations: 1, easing: 'ease', startTs: 1000, ...extra });
const ep = (animations: EpisodeAnimation[], extra: Partial<Episode> = {}): Episode => ({
  id: 'e1', trigger: { id: 't1', kind: 'action', timestamp: 1000, stateId: 's1' }, startTs: 900, endTs: 1500,
  closeReason: 'settled', animations, passive: false, ambientLoop: false, motionOnly: false, ...extra,
});
const fp = (e: Episode, nodes: StructuralNode[]) => episodeFingerprint(e, nodes, new Map(nodes.map((n) => [n.id, n])));

describe('dedup', () => {
  it('same_nav_animation_on_two_pages_is_duplicate', () => {
    const idx = new DedupIndex();
    const a = fp(ep([anim()]), [snode('n1')]);
    const b = fp(ep([anim({ animationId: 'zzz', startTs: 5000 })], { id: 'e2' }), [snode('n99')]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
    idx.add('clipA', a, 'p');
    expect(idx.check(b, 'q', false)).toEqual({ duplicateOf: 'clipA' });
  });

  it('same_keyframes_different_duration_is_not_duplicate', () => {
    expect(fp(ep([anim({ duration: 600 })]), [snode('n1')])).not.toBe(fp(ep([anim()]), [snode('n1')]));
  });

  it('animation_order_does_not_change_fingerprint', () => {
    const a = anim({ name: 'a' }), b = anim({ name: 'b', duration: 100 });
    expect(fp(ep([a, b]), [snode('n1')])).toBe(fp(ep([b, a]), [snode('n1')]));
  });

  it('motion_only_uses_phash_threshold', async () => {
    const mk = (left: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } })
      .composite([{ input: { create: { width: 32, height: 64, channels: 3, background: '#000' } }, left, top: 0 }]).png().toBuffer();
    const [x, y, z] = await Promise.all([mk(0), mk(0), mk(32)]);
    const hx = await framesPHash([x, x]), hy = await framesPHash([y, y]), hz = await framesPHash([z, z]);
    const idx = new DedupIndex();
    idx.add('c1', 'fp1', hx);
    expect(idx.check('other', hy, true)).toEqual({ duplicateOf: 'c1' });
    expect(idx.check('other', hz, true)).toBeNull();
    // identical (empty) fingerprints must not collide for motion-only
    expect(idx.check('fp1', hz, true)).toBeNull();
    // non-motion-only ignores phash
    expect(idx.check('other', hy, false)).toBeNull();
  });

  it('positional_dom_ids_do_not_affect_fingerprint', () => {
    expect(fp(ep([anim()]), [snode('n1')])).toBe(fp(ep([anim()]), [snode('n42')]));
    expect(fp(ep([anim()]), [snode('n1', 'nav')])).not.toBe(fp(ep([anim()]), [snode('n1', 'hero')]));
  });
});
