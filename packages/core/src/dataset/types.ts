import type { BrowserAction } from '../types/browser-actions.js';
import type { AnimationDeviation } from '../pipelines/temporal/collectors/types.js';

export type TriggerKind = 'action' | 'scroll-step' | 'page-load';
export interface Trigger {
  id: string;
  kind: TriggerKind;
  timestamp: number;
  stateId: string;
  action?: BrowserAction;
  scrollY?: number;
}

export type EpisodeCloseReason = 'settled' | 'max-duration' | 'navigated' | 'run-ended';
export interface EpisodeAnimation {
  animationId: string;
  name?: string;
  duration: number;
  delay: number;
  endDelay: number;
  iterations: number;
  easing?: string;
  targetMarker?: string;
  targetTag?: string;
  startTs: number;
  endTs?: number;
  deviation?: AnimationDeviation;
}
export interface Episode {
  id: string;
  trigger: Trigger;
  startTs: number;
  endTs: number;
  closeReason: EpisodeCloseReason;
  animations: EpisodeAnimation[];
  passive: boolean;
  ambientLoop: boolean;
  /** flow/mutation motion with no CDP animation */
  motionOnly: boolean;
}

export type RejectReason =
  | 'bot-challenge' | 'login-wall' | 'error-page' | 'blank' | 'loading' | 'cookie-consent'
  | 'chat-widget' | 'ad' | 'spinner' | 'started-mid-animation' | 'not-settled' | 'offscreen'
  | 'covered' | 'media-playback' | 'no-motion';

// Declared once here (ruling R1); Tasks 5, 7, 8 import them.
export interface FrameTimingSummary {
  frames: number;
  droppedFrames: number;
  longestFrameMs: number;
  longAnimationFrames: number;
  source: 'trace';
}
/** general: flashes per worst 1s window */
export interface FlashResult { general: number; red: number; failsWcag231: boolean }
export type ReducedMotionResult =
  | { status: 'measured'; motionRatio: number }
  | { status: 'not-reproducible'; reason: 'unreachable-state' | 'side-effect-risk' | 'error' | 'budget-exhausted' };

export interface Measurements {
  declared: { durationMs: number; delayMs: number; easing?: string }[];
  measuredDurationMs: number | null;
  fittedEasing: { curve: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'; rmse: number } | null;
  deviationScore: number | null;
  frameTiming: FrameTimingSummary | null;
  layoutShift: number;
  flashes: FlashResult;
  reducedMotion: ReducedMotionResult;
  framesCaptured: number;
  achievedFps: number;
}

export interface Clip {
  schemaVersion: 1;
  id: string;
  runId: string;
  site: string;
  url: string;
  stateId: string;
  episode: Episode;
  kind: string;
  measurements: Measurements;
  fingerprint: string;
  phash: string;
  occurrences: { url: string; stateId: string; triggerId: string }[];
  files: { frames: string[]; keyframes: string[]; beforePng: string; afterPng: string; beforeScene: string; afterScene: string };
  actionLatencyMs: number | null;
  actionSucceeded: boolean | null;
  traceRefs: string[];
}
