import type { Episode, EpisodeAnimation, EpisodeCloseReason, Trigger } from '../types.js';
import type {
  AnimationEndPayload,
  AnimationStartPayload,
  TimelineEvent,
} from '../../pipelines/temporal/collectors/types.js';

export interface SegmenterOptions {
  settleMs: number;
  maxEpisodeMs: number;
  preRollMs: number;
}

export const SEGMENTER_DEFAULTS: SegmenterOptions = { settleMs: 300, maxEpisodeMs: 10_000, preRollMs: 100 };

interface Open {
  trigger: Trigger;
  passive: boolean;
  startTs: number;
  animations: EpisodeAnimation[];
  /** finite animations still running (waiting for animation-end) */
  running: Set<string>;
  /** last moment anything was moving: events, ends, infinite-loop cycle ends */
  lastActiveTs: number;
  ambientLoop: boolean;
  sawMotion: boolean;
}

/** Pure state machine: callers feed triggers/events and poll tick() with a clock. */
export class Segmenter {
  private readonly opts: SegmenterOptions;
  private open: Open | null = null;
  private closed: Episode[] = [];
  private seq = 0;

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...SEGMENTER_DEFAULTS, ...opts };
  }

  onTrigger(t: Trigger): void {
    this.advance(t.timestamp);
    // A new trigger supersedes whatever was still settling.
    this.close('settled', t.timestamp);
    this.openEpisode(t, false, t.timestamp);
  }

  onEvent(e: TimelineEvent): void {
    this.advance(e.timestamp);
    if (e.type === 'animation-start') {
      const p = e.payload as AnimationStartPayload;
      if (!this.open) this.openEpisode(this.syntheticTrigger(e.timestamp), true, e.timestamp);
      this.addAnimation(this.open!, p, e.timestamp);
    } else if (!this.open) {
      return;
    } else if (e.type === 'animation-end') {
      const p = e.payload as AnimationEndPayload;
      const anim = this.open.animations.find((a) => a.animationId === p.animationId);
      if (anim) {
        anim.endTs = e.timestamp;
        if (p.deviation) anim.deviation = p.deviation;
      }
      this.open.running.delete(p.animationId);
      this.open.lastActiveTs = Math.max(this.open.lastActiveTs, e.timestamp);
    } else if (e.type === 'mutation' || e.type === 'optical-flow-motion') {
      this.open.sawMotion = true;
      this.open.lastActiveTs = Math.max(this.open.lastActiveTs, e.timestamp);
    }
  }

  onNavigated(ts: number): void {
    this.advance(ts);
    this.close('navigated', ts);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  tick(now: number): Episode[] {
    this.advance(now);
    return this.drain();
  }

  flush(now: number): Episode[] {
    this.advance(now);
    this.close('run-ended', now);
    return this.drain();
  }

  private drain(): Episode[] {
    const out = this.closed;
    this.closed = [];
    return out;
  }

  private advance(now: number): void {
    const o = this.open;
    if (!o) return;
    const maxEnd = o.startTs + this.opts.maxEpisodeMs;
    if (now >= maxEnd) {
      this.close('max-duration', maxEnd);
    } else if (o.running.size === 0 && now - o.lastActiveTs >= this.opts.settleMs) {
      this.close('settled', o.lastActiveTs);
    }
  }

  private openEpisode(trigger: Trigger, passive: boolean, ts: number): void {
    this.open = {
      trigger,
      passive,
      startTs: ts - this.opts.preRollMs,
      animations: [],
      running: new Set(),
      lastActiveTs: ts,
      ambientLoop: false,
      sawMotion: false,
    };
  }

  private addAnimation(o: Open, p: AnimationStartPayload, ts: number): void {
    const delay = p.delay ?? 0;
    const iterations = p.iterations ?? 1;
    o.animations.push({
      animationId: p.animationId,
      name: p.name,
      duration: p.duration,
      delay,
      endDelay: p.endDelay ?? 0,
      iterations,
      easing: p.easing,
      targetMarker: p.targetMarker,
      targetTag: p.targetTag,
      startTs: ts,
    });
    if (iterations === Infinity) {
      // Keep one cycle only; the loop never holds the episode open past it.
      o.ambientLoop = true;
      o.lastActiveTs = Math.max(o.lastActiveTs, ts + p.duration + delay);
    } else {
      o.running.add(p.animationId);
      o.lastActiveTs = Math.max(o.lastActiveTs, ts);
    }
  }

  private close(reason: EpisodeCloseReason, endTs: number): void {
    const o = this.open;
    if (!o) return;
    this.open = null;
    this.closed.push({
      id: `ep-${++this.seq}`,
      trigger: o.trigger,
      startTs: o.startTs,
      endTs,
      closeReason: reason,
      animations: o.animations,
      passive: o.passive,
      ambientLoop: o.ambientLoop,
      motionOnly: o.animations.length === 0 && o.sawMotion,
    });
  }

  private syntheticTrigger(ts: number): Trigger {
    return { id: `passive-${this.seq + 1}`, kind: 'page-load', timestamp: ts, stateId: '' };
  }
}
