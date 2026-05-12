import type {
  AnimationDeviation,
  PerPropertyDeviation,
  PropertyPrediction,
  SupportedProperty,
} from '../../collectors/types.js';

// Per-property normalization scales. 1.0 of normalizedDelta corresponds to
// the listed delta — calibrated for visible deviations on typical UI elements.
// See spec section "Deviation normalization" for rationale.
export const SCALE: Record<SupportedProperty, number> = {
  translateX: 50,
  translateY: 50,
  scale:      0.25,
  rotate:     0.5,
  opacity:    0.2,
  width:      50,
  height:     50,
  top:        50,
  left:       50,
  right:      50,
  bottom:     50,
};

export function computeDeviation(
  predicted: PropertyPrediction[],
  observed: Partial<Record<SupportedProperty, number>>,
): AnimationDeviation {
  const perProperty: PerPropertyDeviation[] = [];
  for (const p of predicted) {
    const obs = observed[p.property];
    if (obs === undefined) continue;
    const delta = obs - p.endValue;
    const normalizedDelta = Math.min(Math.abs(delta) / SCALE[p.property], 1);
    perProperty.push({
      property: p.property,
      predicted: p.endValue,
      observed: obs,
      delta,
      normalizedDelta,
    });
  }
  const score = perProperty.length === 0 ? 0 : Math.max(...perProperty.map((p) => p.normalizedDelta));
  return { perProperty, score };
}
