export interface NormalizedKeyframe {
  offset: number;
  properties: Record<string, number>;
}

export interface KeyframeTiming {
  iterations: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
}

// Returns the property values at the animation's final state, or null if the
// timing configuration is unsupported by v1.
//
// Supported: iterations === 1 && direction === 'normal'. For this case, the
// final state is the keyframe at offset === 1 — independent of easing function,
// because every CSS/WAAPI easing maps offset=1 -> value=1 by spec.
export function valueAtFinalState(
  keyframes: NormalizedKeyframe[],
  timing: KeyframeTiming,
): Record<string, number> | null {
  if (timing.iterations !== 1) return null;
  if (timing.direction !== 'normal') return null;
  const final = keyframes.find((k) => k.offset === 1);
  if (!final) return null;
  return final.properties;
}
