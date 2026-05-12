import { describe, it, expect } from 'vitest';
import type { StateTransition, TransitionType, KeyframeEvent, SceneGraphDiff } from '../../../src/types/index.js';
import type {
  AnimationPredictionPayload,
  AnimationEndPayload,
  TimelineEvent,
} from '../../../src/pipelines/temporal/collectors/types.js';

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

describe('AnimationPredictionPayload', () => {
  it('accepts a complete prediction shape', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-1',
      expectedEndTimestamp: 1234,
      boundingBox: { x: 10, y: 20, w: 100, h: 50 },
      predicted: [
        { property: 'translateX', endValue: 240, unit: 'px' },
        { property: 'opacity', endValue: 1, unit: 'scalar' },
      ],
    };
    expect(payload.predicted).toHaveLength(2);
  });

  it('accepts a skipped prediction with empty predicted array', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-2',
      expectedEndTimestamp: 1234,
      boundingBox: null,
      predicted: [],
      skipped: { reason: 'unsupported-timing' },
    };
    expect(payload.skipped?.reason).toBe('unsupported-timing');
  });

  it('accepts unsupportedProperties listing Tier-3 props', () => {
    const payload: AnimationPredictionPayload = {
      animationId: 'a-3',
      expectedEndTimestamp: 1234,
      boundingBox: { x: 0, y: 0, w: 10, h: 10 },
      predicted: [{ property: 'translateX', endValue: 100, unit: 'px' }],
      unsupportedProperties: ['background-color', 'filter'],
    };
    expect(payload.unsupportedProperties).toContain('background-color');
  });
});

describe('Extended AnimationEndPayload', () => {
  it('accepts an end event with deviation', () => {
    const payload: AnimationEndPayload = {
      animationId: 'a-1',
      reason: 'completed',
      deviation: {
        perProperty: [{
          property: 'translateX',
          predicted: 100,
          observed: 102,
          delta: 2,
          normalizedDelta: 0.04,
        }],
        score: 0.04,
      },
    };
    expect(payload.deviation?.score).toBe(0.04);
  });

  it('accepts an end event without deviation', () => {
    const payload: AnimationEndPayload = { animationId: 'a-1', reason: 'completed' };
    expect(payload.deviation).toBeUndefined();
  });

  it('accepts a canceled end event without deviation', () => {
    const payload: AnimationEndPayload = { animationId: 'a-1', reason: 'canceled' };
    expect(payload.reason).toBe('canceled');
  });
});

describe('animation-prediction TimelineEvent', () => {
  it('typechecks with PayloadFor mapping', () => {
    const event: TimelineEvent<'animation-prediction'> = {
      id: 'evt-1',
      type: 'animation-prediction',
      timestamp: 0,
      payload: {
        animationId: 'a-1',
        expectedEndTimestamp: 300,
        boundingBox: null,
        predicted: [],
        skipped: { reason: 'no-keyframes' },
      },
    };
    expect(event.type).toBe('animation-prediction');
  });
});
