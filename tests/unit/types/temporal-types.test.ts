import { describe, it, expect } from 'vitest';
import type { StateTransition, TransitionType, KeyframeEvent, SceneGraphDiff } from '../../../src/types/index.js';

describe('Temporal types', () => {
  const emptyDiff: SceneGraphDiff = { added: [], removed: [], modified: [], stable: [] };

  it('StateTransition without trigger/duration is valid', () => {
    const transition: StateTransition = {
      type: 'navigation',
      timestamp: Date.now(),
      diff: emptyDiff,
    };
    expect(transition.type).toBe('navigation');
    expect(transition.trigger).toBeUndefined();
    expect(transition.duration).toBeUndefined();
  });

  it('StateTransition with trigger and duration is valid', () => {
    const transition: StateTransition = {
      type: 'content_loaded',
      timestamp: Date.now(),
      diff: emptyDiff,
      trigger: 'click',
      duration: 250,
    };
    expect(transition.trigger).toBe('click');
    expect(transition.duration).toBe(250);
  });

  it('KeyframeEvent compiles with all required fields', () => {
    const event: KeyframeEvent = {
      frame: Buffer.from('fake-png'),
      timestamp: Date.now(),
      trigger: 'significant_diff',
    };
    expect(event.frame).toBeInstanceOf(Buffer);
    expect(event.trigger).toBe('significant_diff');
    expect(event.metadata).toBeUndefined();
  });

  it('KeyframeEvent accepts optional metadata', () => {
    const event: KeyframeEvent = {
      frame: Buffer.from('fake-png'),
      timestamp: Date.now(),
      trigger: 'user_event',
      metadata: { action: 'click', x: 100, y: 200 },
    };
    expect(event.metadata).toEqual({ action: 'click', x: 100, y: 200 });
  });

  it('new TransitionType values are assignable', () => {
    const newTypes: TransitionType[] = ['page_load', 'content_update', 'error_state', 'loading_state', 'idle'];
    expect(newTypes).toHaveLength(5);

    // Existing types still work
    const existingTypes: TransitionType[] = ['navigation', 'modal_open', 'modal_close', 'content_loaded', 'animation'];
    expect(existingTypes).toHaveLength(5);
  });
});
