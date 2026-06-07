import type { CDPSession } from 'playwright';
import type {
  AnimationDeviation,
  AnimationPredictionPayload,
  PropertyPrediction,
  SkipReason,
  SupportedProperty,
} from '../../collectors/types.js';
import { computeDeviation } from './deviation.js';
import { valueAtFinalState, type KeyframeTiming } from './interpolation.js';
import { parseRawKeyframes } from './keyframes.js';

interface PendingPrediction {
  predicted: PropertyPrediction[];
  objectId: string;
}

interface CapturedFromPage {
  keyframes: Array<{ offset: number; [key: string]: unknown }>;
  timing: KeyframeTiming;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

// Runs as `this` = in-page Animation object. Returns keyframes, timing, and
// the target element's bounding rect. All work happens on the page; the host
// only receives plain JSON.
const READ_AT_START_SCRIPT = `
  function() {
    const anim = this;
    let bbox = null;
    try {
      const target = anim.effect && anim.effect.target;
      if (target && typeof target.getBoundingClientRect === 'function') {
        const r = target.getBoundingClientRect();
        bbox = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    } catch (_e) {}
    return {
      keyframes: anim.effect ? anim.effect.getKeyframes() : [],
      timing: anim.effect ? anim.effect.getComputedTiming() : {},
      bbox,
    };
  }
`;

// Runs as `this` = in-page Animation object. Reads computed style at the
// moment of call — intended to be called just after animation-end fires.
// Matrix indices: matrix(a,b,c,d,e,f) → tx=e (index 4), ty=f (index 5).
// matrix3d (column-major 4×4) → tx=m41 (index 12), ty=m42 (index 13).
const READ_AT_END_SCRIPT = `
  function() {
    const anim = this;
    const target = anim.effect && anim.effect.target;
    if (!target) return null;
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    const tf = cs.transform;
    const out = {};

    // matrix(a,b,c,d,e,f): e=v[4]=tx, f=v[5]=ty. scale=sqrt(a^2+b^2),
    // rotate=atan2(b,a). matrix3d is column-major 4x4: tx=v[12]=m41,
    // ty=v[13]=m42. atan2 returns radians in [-pi, pi] — for
    // single-iteration animations under one full turn this matches the
    // predicted rotate (also radians). Multi-turn rotates wrap and
    // would yield large deviation; v1 skips those via unsupported-timing.
    if (tf && tf !== 'none') {
      const m = tf.match(/^matrix\\(([^)]+)\\)$/);
      if (m) {
        const v = m[1].split(',').map(parseFloat);
        out.translateX = v[4];
        out.translateY = v[5];
        out.scale = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        out.rotate = Math.atan2(v[1], v[0]);
      } else {
        const m3 = tf.match(/^matrix3d\\(([^)]+)\\)$/);
        if (m3) {
          const v = m3[1].split(',').map(parseFloat);
          out.translateX = v[12];
          out.translateY = v[13];
          out.scale = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
          out.rotate = Math.atan2(v[1], v[0]);
        }
      }
    }
    out.opacity = parseFloat(cs.opacity);
    out.width = r.width;
    out.height = r.height;
    out.top = r.top;
    out.left = r.left;
    return out;
  }
`;

const SUPPORTED_PROPS: readonly SupportedProperty[] = [
  'translateX', 'translateY', 'scale', 'rotate',
  'opacity',
  'width', 'height',
  'top', 'left', 'right', 'bottom',
];

const UNIT: Record<SupportedProperty, 'px' | 'rad' | 'ratio' | 'scalar'> = {
  translateX: 'px', translateY: 'px',
  scale: 'ratio',
  rotate: 'rad',
  opacity: 'scalar',
  width: 'px', height: 'px',
  top: 'px', left: 'px', right: 'px', bottom: 'px',
};

function toPropertyPredictions(state: Record<string, number>): PropertyPrediction[] {
  const out: PropertyPrediction[] = [];
  for (const prop of SUPPORTED_PROPS) {
    if (prop in state) {
      out.push({ property: prop, endValue: state[prop], unit: UNIT[prop] });
    }
  }
  return out;
}

export class AnimationVerifier {
  private pending = new Map<string, PendingPrediction>();

  async captureStart(
    cdp: CDPSession,
    params: { animation: { id: string; source?: { duration?: number } } },
  ): Promise<AnimationPredictionPayload> {
    const a = params.animation;
    const duration = a.source?.duration ?? 0;
    // expectedEndTimestamp here is a millisecond OFFSET (== duration).
    // The collector (Task 6) overwrites this to an absolute timeline
    // timestamp (startTimestamp + duration) at push time. The verifier
    // doesn't have access to startTimestamp, so it carries the offset
    // and lets the collector apply the anchor.
    const expectedEndTimestamp = duration;

    if (duration === 0) {
      return this.skipped(a.id, 'zero-duration', expectedEndTimestamp);
    }

    let objectId: string;
    try {
      const resolved: any = await cdp.send('Animation.resolveAnimation' as any, { animationId: a.id } as any);
      objectId = resolved?.remoteObject?.objectId;
      if (!objectId) {
        return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
      }
    } catch {
      return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
    }

    let captured: CapturedFromPage;
    try {
      const res: any = await cdp.send('Runtime.callFunctionOn' as any, {
        objectId,
        functionDeclaration: READ_AT_START_SCRIPT,
        returnByValue: true,
      } as any);
      captured = res?.result?.value as CapturedFromPage;
      if (!captured) {
        return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
      }
    } catch {
      return this.skipped(a.id, 'resolve-failed', expectedEndTimestamp);
    }

    if (!captured.bbox) {
      return this.skipped(a.id, 'no-target-node', expectedEndTimestamp);
    }

    if ((captured.keyframes ?? []).length === 0) {
      return this.skipped(a.id, 'no-keyframes', expectedEndTimestamp, captured.bbox);
    }

    const { keyframes, unsupportedProperties } = parseRawKeyframes(
      captured.keyframes as Array<{ offset: number; [key: string]: unknown }>,
    );
    const finalState = valueAtFinalState(keyframes, captured.timing);
    if (finalState === null) {
      return this.skipped(a.id, 'unsupported-timing', expectedEndTimestamp, captured.bbox);
    }

    const predicted = toPropertyPredictions(finalState);
    if (predicted.length === 0) {
      return {
        animationId: a.id,
        expectedEndTimestamp,
        boundingBox: captured.bbox,
        predicted: [],
        unsupportedProperties: unsupportedProperties.length > 0 ? unsupportedProperties : undefined,
        skipped: { reason: 'unsupported-only' },
      };
    }

    this.pending.set(a.id, { predicted, objectId });

    return {
      animationId: a.id,
      expectedEndTimestamp,
      boundingBox: captured.bbox,
      predicted,
      unsupportedProperties: unsupportedProperties.length > 0 ? unsupportedProperties : undefined,
    };
  }

  async observe(cdp: CDPSession, animationId: string): Promise<AnimationDeviation | null> {
    const pending = this.pending.get(animationId);
    if (!pending) return null;
    // Drop state before any await so it's always removed, even on exception.
    this.pending.delete(animationId);

    let observed: Partial<Record<SupportedProperty, number>>;
    try {
      const res: any = await cdp.send('Runtime.callFunctionOn' as any, {
        objectId: pending.objectId,
        functionDeclaration: READ_AT_END_SCRIPT,
        returnByValue: true,
      } as any);
      observed = res?.result?.value as Partial<Record<SupportedProperty, number>>;
      if (!observed) return null;
    } catch {
      return null;
    }

    return computeDeviation(pending.predicted, observed);
  }

  discard(animationId: string): void {
    this.pending.delete(animationId);
  }

  clear(): void {
    this.pending.clear();
  }

  hasPending(animationId: string): boolean {
    return this.pending.has(animationId);
  }

  private skipped(
    animationId: string,
    reason: SkipReason,
    expectedEndTimestamp: number,
    boundingBox: { x: number; y: number; w: number; h: number } | null = null,
  ): AnimationPredictionPayload {
    return {
      animationId,
      expectedEndTimestamp,
      boundingBox,
      predicted: [],
      skipped: { reason },
    };
  }
}
