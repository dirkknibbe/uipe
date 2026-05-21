import type { PerceptionTier, AnomalyReason } from '../temporal/collectors/types.js';

export interface PerceptionSessionSummary {
  startedAt: number;                  // stream-relative ms at session start
  durationMs: number;                 // wall-clock elapsed since startedAt
  tickCounts: Record<PerceptionTier, number>;
  averageCadenceMs: Record<PerceptionTier, number | null>;  // null if loop never ticked
  targetCadenceMs: Record<PerceptionTier, number>;          // declared target
  anomalyCount: number;
  anomaliesByReason: Record<AnomalyReason, number>;
  escalationCount: number;
  intentResultCount: number;
  vlmCalls: { count: number; estimatedDollars?: number };
}
