import type { Page } from 'playwright';
import type { TemporalEventStream } from '../event-stream.js';

export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'animation-prediction'
  | 'phash-change'
  | 'optical-flow-raw'
  | 'optical-flow-region'
  | 'optical-flow-motion';

export interface InputPayload {
  kind: 'click' | 'keydown';
  target?: string;
  key?: string;
  position?: { x: number; y: number };
}

export interface MutationPayload {
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
}

export interface NetworkRequestPayload {
  requestId: string;
  url: string;
  method: string;
}

export interface NetworkResponsePayload {
  requestId: string;
  url: string;
  status: number;
}

export interface AnimationStartPayload {
  animationId: string;
  name?: string;
  duration: number;
  easing?: string;
  target?: string;
}

export type SupportedProperty =
  | 'translateX' | 'translateY' | 'scale' | 'rotate'
  | 'opacity'
  | 'width' | 'height'
  | 'top' | 'left' | 'right' | 'bottom';

export type PropertyUnit = 'px' | 'rad' | 'ratio' | 'scalar';

export interface PropertyPrediction {
  property: SupportedProperty;
  endValue: number;
  unit: PropertyUnit;
}

export type SkipReason =
  | 'no-keyframes'
  | 'unsupported-only'
  | 'unsupported-timing'
  | 'zero-duration'
  | 'resolve-failed'
  | 'no-target-node';

export interface AnimationPredictionPayload {
  animationId: string;
  expectedEndTimestamp: number;
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  predicted: PropertyPrediction[];
  unsupportedProperties?: string[];
  skipped?: { reason: SkipReason };
}

export interface PerPropertyDeviation {
  property: SupportedProperty;
  predicted: number;
  observed: number;
  delta: number;
  normalizedDelta: number;
}

export interface AnimationDeviation {
  perProperty: PerPropertyDeviation[];
  score: number;
}

export interface AnimationEndPayload {
  animationId: string;
  reason: 'completed' | 'canceled';
  deviation?: AnimationDeviation;
}

export interface PHashChangePayload {
  region: { x: number; y: number; width: number; height: number };
  hammingDistance: number;
}

export interface OpticalFlowRawPayload {
  frameTimestamp: number;
  keypoints: Array<{ x: number; y: number; vx: number; vy: number; magnitude: number }>;
  gridSummary: { cols: number; rows: number; vectors: number[] };
}

export interface OpticalFlowRegionPayload {
  frameTimestamp: number;
  regionId: string;
  bbox: { x: number; y: number; w: number; h: number };
  primitives: {
    meanVelocity: { vx: number; vy: number };
    divergence: number;
    curl: number;
    speedVariance: number;
    pointCount: number;
  };
}

export type MotionPattern = 'translation' | 'scale' | 'rotation' | 'stillness';

export type MotionPatternParams =
  | { direction: { vx: number; vy: number }; speedPxPerSec: number }
  | { sign: 'expand' | 'contract'; centroid: { x: number; y: number }; rate: number }
  | { sign: 'cw' | 'ccw'; centroid: { x: number; y: number }; angularSpeedRadPerSec: number }
  | { durationMs: number }
  | Record<string, never>;

export interface OpticalFlowMotionPayload {
  endTs?: number;
  regionId: string;
  pattern: MotionPattern;
  params: MotionPatternParams;
  confidence: number;
}

export type PayloadFor<T extends EventType> =
  T extends 'input'             ? InputPayload :
  T extends 'mutation'          ? MutationPayload :
  T extends 'network-request'   ? NetworkRequestPayload :
  T extends 'network-response'  ? NetworkResponsePayload :
  T extends 'animation-start'   ? AnimationStartPayload :
  T extends 'animation-end'     ? AnimationEndPayload :
  T extends 'animation-prediction' ? AnimationPredictionPayload :
  T extends 'phash-change'      ? PHashChangePayload :
  T extends 'optical-flow-raw'    ? OpticalFlowRawPayload :
  T extends 'optical-flow-region' ? OpticalFlowRegionPayload :
  T extends 'optical-flow-motion' ? OpticalFlowMotionPayload :
  never;

export interface TimelineEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  timestamp: number;
  payload: PayloadFor<T>;
}

export interface Collector {
  readonly name: string;
  attach(page: Page, stream: TemporalEventStream): Promise<void>;
  detach(): Promise<void>;
}
