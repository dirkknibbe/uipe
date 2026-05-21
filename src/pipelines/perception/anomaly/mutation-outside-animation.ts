/**
 * A lightweight record of a single DOM mutation, maintained by FrameLoop's
 * ring buffer. We don't reuse TimelineEvent<'mutation'> directly because the
 * existing MutationPayload is a batched summary (counts only, no node IDs);
 * FrameLoop enriches each observation with the node ID before storing it.
 */
export interface MutationRecord {
  timestamp: number;
  targetNodeId: string;
}

export interface DetectInput {
  recentMutations: MutationRecord[];
  activeAnimations: Set<string>;
  nowMs: number;
  sessionStartMs: number;
}

export interface DetectConfig {
  lookbackMs: number;
  coalesceWindowMs: number;
  warmupMs: number;
}

export type DetectResult =
  | null
  | { mutationCount: number; targetNodeIds: string[] };

export const DEFAULT_CONFIG: DetectConfig = {
  lookbackMs: 200,
  coalesceWindowMs: 100,
  warmupMs: 500,
};

/**
 * Pure detector for the v1 anomaly trigger. Returns a result when:
 *   - past the warmup window
 *   - no animation is currently active
 *   - at least one mutation falls within the latest coalesced burst
 *
 * `recentMutations` is assumed to already be trimmed to `lookbackMs` by the
 * caller (FrameLoop maintains a ring buffer).
 */
export function detectMutationOutsideAnimation(
  input: DetectInput,
  config: DetectConfig = DEFAULT_CONFIG,
): DetectResult {
  // 1. Warmup gate
  if (input.nowMs - input.sessionStartMs < config.warmupMs) return null;

  // 2. Active animation gate
  if (input.activeAnimations.size > 0) return null;

  // 3. Coalesce — group mutations into bursts, take the latest
  if (input.recentMutations.length === 0) return null;

  // Sort by timestamp ascending to make grouping deterministic
  const sorted = [...input.recentMutations].sort((a, b) => a.timestamp - b.timestamp);

  // Find the latest burst by walking backwards: include events while the gap
  // to the previous event is ≤ coalesceWindowMs.
  const latest = sorted[sorted.length - 1];
  const burst: MutationRecord[] = [latest];
  for (let i = sorted.length - 2; i >= 0; i--) {
    const gap = burst[burst.length - 1].timestamp - sorted[i].timestamp;
    if (gap > config.coalesceWindowMs) break;
    burst.push(sorted[i]);
  }

  // 4. Empty short-circuit (defensive — shouldn't hit since we returned null above on empty)
  if (burst.length === 0) return null;

  // 5. Emit. Reverse burst to chronological order, then dedupe target IDs.
  burst.reverse();
  const uniqueIds = Array.from(new Set(burst.map((e) => e.targetNodeId)));
  return {
    mutationCount: burst.length,
    targetNodeIds: uniqueIds,
  };
}
