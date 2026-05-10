import type { Page } from 'playwright';
// Forward declaration — TemporalEventStream defined in Task 2
export interface TemporalEventStream {
  push(event: TimelineEvent): void;
}

export type EventType =
  | 'input'
  | 'mutation'
  | 'network-request'
  | 'network-response'
  | 'animation-start'
  | 'animation-end'
  | 'phash-change';

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

export interface AnimationEndPayload {
  animationId: string;
  reason: 'completed' | 'canceled';
}

export interface PHashChangePayload {
  region: { x: number; y: number; width: number; height: number };
  hammingDistance: number;
}

export type PayloadFor<T extends EventType> =
  T extends 'input'             ? InputPayload :
  T extends 'mutation'          ? MutationPayload :
  T extends 'network-request'   ? NetworkRequestPayload :
  T extends 'network-response'  ? NetworkResponsePayload :
  T extends 'animation-start'   ? AnimationStartPayload :
  T extends 'animation-end'     ? AnimationEndPayload :
  T extends 'phash-change'      ? PHashChangePayload :
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
