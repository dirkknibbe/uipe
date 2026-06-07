import { describe, it, expect } from 'vitest';
import type {
  PerceptionTier,
  AnomalyReason,
  PerceptionTickPayload,
  PerceptionAnomalyPayload,
  PerceptionEscalationPayload,
  PerceptionIntentResultPayload,
  TimelineEvent,
} from '../../../../src/pipelines/temporal/collectors/types.js';
import type { PerceptionSessionSummary } from '../../../../src/pipelines/perception/types.js';

describe('PerceptionTier', () => {
  it('accepts the three tier values', () => {
    const tiers: PerceptionTier[] = ['frame', 'semantic', 'intent'];
    expect(tiers).toHaveLength(3);
  });
});

describe('AnomalyReason', () => {
  it('accepts the v1 reason', () => {
    const r: AnomalyReason = 'mutation-outside-animation';
    expect(r).toBe('mutation-outside-animation');
  });
});

describe('PerceptionTickPayload', () => {
  it('accepts each cause value', () => {
    const causes: Array<PerceptionTickPayload['cause']> = ['keyframe', 'heartbeat', 'escalation', 'navigation-reset'];
    const payloads = causes.map((cause) => ({ tier: 'frame' as const, cause }));
    expect(payloads).toHaveLength(4);
  });
});

describe('PerceptionAnomalyPayload', () => {
  it('accepts a full anomaly shape', () => {
    const p: PerceptionAnomalyPayload = {
      tier: 'frame',
      reason: 'mutation-outside-animation',
      detail: { mutationCount: 3, targetNodeIds: ['dom-1', 'dom-2'] },
    };
    expect(p.detail.mutationCount).toBe(3);
  });
});

describe('PerceptionEscalationPayload', () => {
  it('accepts a frame→semantic escalation', () => {
    const p: PerceptionEscalationPayload = {
      from: 'frame',
      to: 'semantic',
      reason: 'mutation-outside-animation',
      regions: [{ nodeId: 'dom-1', bbox: { x: 0, y: 0, w: 100, h: 50 } }],
    };
    expect(p.regions).toHaveLength(1);
  });
});

describe('PerceptionIntentResultPayload', () => {
  it('accepts a complete intent result', () => {
    const p: PerceptionIntentResultPayload = {
      region: { nodeId: 'dom-1', bbox: { x: 0, y: 0, w: 100, h: 50 } },
      classification: 'AnimatedCounter',
      classificationSource: 'vlm',
      durationMs: 873,
    };
    expect(p.classification).toBe('AnimatedCounter');
  });
});

describe('TimelineEvent<perception-*>', () => {
  it('perception-tick typechecks via PayloadFor mapping', () => {
    const e: TimelineEvent<'perception-tick'> = {
      id: 'evt-1', type: 'perception-tick', timestamp: 0,
      payload: { tier: 'frame', cause: 'keyframe' },
    };
    expect(e.type).toBe('perception-tick');
  });

  it('perception-anomaly typechecks', () => {
    const e: TimelineEvent<'perception-anomaly'> = {
      id: 'evt-2', type: 'perception-anomaly', timestamp: 0,
      payload: { tier: 'frame', reason: 'mutation-outside-animation', detail: { mutationCount: 1, targetNodeIds: ['x'] } },
    };
    expect(e.type).toBe('perception-anomaly');
  });

  it('perception-escalation typechecks', () => {
    const e: TimelineEvent<'perception-escalation'> = {
      id: 'evt-3', type: 'perception-escalation', timestamp: 0,
      payload: { from: 'frame', to: 'semantic', reason: 'mutation-outside-animation', regions: [] },
    };
    expect(e.type).toBe('perception-escalation');
  });

  it('perception-intent-result typechecks', () => {
    const e: TimelineEvent<'perception-intent-result'> = {
      id: 'evt-4', type: 'perception-intent-result', timestamp: 0,
      payload: {
        region: { nodeId: 'x', bbox: { x: 0, y: 0, w: 10, h: 10 } },
        classification: 'X',
        classificationSource: 'vlm',
        durationMs: 100,
      },
    };
    expect(e.type).toBe('perception-intent-result');
  });
});

describe('PerceptionSessionSummary', () => {
  it('accepts a complete summary shape', () => {
    const s: PerceptionSessionSummary = {
      startedAt: 0,
      durationMs: 5000,
      tickCounts: { frame: 12, semantic: 3, intent: 1 },
      averageCadenceMs: { frame: 100, semantic: 1500, intent: null },
      targetCadenceMs: { frame: 16, semantic: 200, intent: 1000 },
      anomalyCount: 2,
      anomaliesByReason: { 'mutation-outside-animation': 2 },
      escalationCount: 3,
      intentResultCount: 1,
      vlmCalls: { count: 1, estimatedDollars: 0.02 },
    };
    expect(s.anomalyCount).toBe(2);
  });

  it('accepts a summary with null averageCadenceMs for an unused tier', () => {
    const s: PerceptionSessionSummary = {
      startedAt: 0, durationMs: 100,
      tickCounts: { frame: 0, semantic: 0, intent: 0 },
      averageCadenceMs: { frame: null, semantic: null, intent: null },
      targetCadenceMs: { frame: 16, semantic: 200, intent: 1000 },
      anomalyCount: 0,
      anomaliesByReason: { 'mutation-outside-animation': 0 },
      escalationCount: 0,
      intentResultCount: 0,
      vlmCalls: { count: 0 },
    };
    expect(s.tickCounts.frame).toBe(0);
  });
});
