import { describe, it, expect } from 'vitest';
import { Segmenter } from '../../../../src/dataset/recorder/segmenter.js';
import type { Trigger } from '../../../../src/dataset/types.js';
import type { TimelineEvent } from '../../../../src/pipelines/temporal/collectors/types.js';

const trig = (ts: number, id = 't1'): Trigger => ({ id, kind: 'action', timestamp: ts, stateId: 's1' });
const start = (id: string, ts: number, extra: Record<string, unknown> = {}): TimelineEvent =>
  ({ id: `e-${id}-s`, type: 'animation-start', timestamp: ts, payload: { animationId: id, duration: 200, ...extra } }) as TimelineEvent;
const end = (id: string, ts: number): TimelineEvent =>
  ({ id: `e-${id}-e`, type: 'animation-end', timestamp: ts, payload: { animationId: id, reason: 'completed' } }) as TimelineEvent;
const flow = (ts: number): TimelineEvent =>
  ({ id: `f${ts}`, type: 'optical-flow-motion', timestamp: ts, payload: { regionId: 'r', pattern: 'translation', params: {}, confidence: 1 } }) as TimelineEvent;

describe('Segmenter', () => {
  it('groups_stagger_from_one_trigger_into_one_episode', () => {
    const s = new Segmenter();
    s.onTrigger(trig(1000));
    ['backdrop', 'panel', 'c1', 'c2', 'c3'].forEach((id, i) => s.onEvent(start(id, 1010 + i * 50)));
    ['backdrop', 'panel', 'c1', 'c2', 'c3'].forEach((id, i) => s.onEvent(end(id, 1300 + i * 50)));
    const eps = s.tick(2000);
    expect(eps).toHaveLength(1);
    expect(eps[0].animations).toHaveLength(5);
    expect(eps[0].passive).toBe(false);
    expect(eps[0].trigger.id).toBe('t1');
  });

  it('picks_up_a_target_marker_filled_into_the_start_payload_after_the_event', () => {
    // The animation collector pushes the start event first and fills target fields in place later.
    const s = new Segmenter();
    s.onTrigger(trig(0));
    const e = start('a', 10);
    s.onEvent(e);
    Object.assign(e.payload as object, { targetMarker: 'm-a', targetTag: 'div' });
    s.onEvent(end('a', 210));
    const [ep] = s.tick(600);
    expect(ep.animations[0]).toMatchObject({ targetMarker: 'm-a', targetTag: 'div' });
  });

  it('ignores_event_types_it_does_not_segment_on_and_their_clocks', () => {
    // Network events carry CDP monotonic timestamps on another clock; they must not close episodes.
    const s = new Segmenter();
    s.onTrigger(trig(1000));
    s.onEvent({ id: 'n1', type: 'network-response', timestamp: 9e9, payload: {} } as unknown as TimelineEvent);
    s.onEvent(start('a', 1010));
    s.onEvent(end('a', 1210));
    const eps = s.tick(1600);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ closeReason: 'settled', passive: false });
    expect(eps[0].animations).toHaveLength(1);
  });

  it('closes_after_settle_window', () => {
    const s = new Segmenter();
    s.onTrigger(trig(0));
    s.onEvent(start('a', 10));
    s.onEvent(end('a', 210));
    expect(s.tick(400)).toEqual([]);
    const eps = s.tick(510);
    expect(eps).toHaveLength(1);
    expect(eps[0].closeReason).toBe('settled');
    expect(eps[0].endTs).toBe(210);
    expect(s.tick(5000)).toEqual([]);
  });

  it('closes_episode_at_max_duration_on_endless_motion', () => {
    const s = new Segmenter();
    s.onTrigger(trig(0));
    for (let t = 50; t < 12_000; t += 50) s.onEvent(flow(t));
    const eps = s.tick(12_000);
    expect(eps).toHaveLength(1);
    expect(eps[0].closeReason).toBe('max-duration');
    expect(eps[0].endTs - eps[0].startTs).toBeLessThanOrEqual(10_000);
  });

  it('infinite_loop_kept_as_one_cycle_marked_ambient', () => {
    const s = new Segmenter();
    s.onTrigger(trig(0));
    s.onEvent(start('spin', 10, { iterations: Infinity, duration: 1000, delay: 100 }));
    expect(s.tick(800)).toEqual([]);
    const eps = s.tick(1110 + 300);
    expect(eps).toHaveLength(1);
    expect(eps[0].ambientLoop).toBe(true);
    expect(eps[0].closeReason).toBe('settled');
    expect(eps[0].animations).toHaveLength(1);
    expect(eps[0].endTs).toBe(1110);
  });

  it('navigation_mid_episode_closes_with_reason_navigated', () => {
    const s = new Segmenter();
    s.onTrigger(trig(0));
    s.onEvent(start('a', 10));
    s.onEvent(start('b', 20));
    s.onNavigated(100);
    const eps = s.tick(100);
    expect(eps).toHaveLength(1);
    expect(eps[0].closeReason).toBe('navigated');
    expect(eps[0].animations.map((a) => a.animationId)).toEqual(['a', 'b']);
  });

  it('passive_animation_without_trigger_opens_passive_episode', () => {
    const s = new Segmenter();
    s.onEvent(start('a', 500));
    s.onEvent(end('a', 700));
    const eps = s.tick(1100);
    expect(eps).toHaveLength(1);
    expect(eps[0].passive).toBe(true);
    expect(eps[0].animations).toHaveLength(1);
  });

  it('flow_motion_only_episode_is_motion_only', () => {
    const s = new Segmenter();
    s.onTrigger(trig(0));
    s.onEvent(flow(50));
    s.onEvent(flow(100));
    const eps = s.flush(120);
    expect(eps).toHaveLength(1);
    expect(eps[0].motionOnly).toBe(true);
    expect(eps[0].closeReason).toBe('run-ended');
  });
});
