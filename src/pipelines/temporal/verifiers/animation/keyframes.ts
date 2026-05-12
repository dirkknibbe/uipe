import type { NormalizedKeyframe } from './interpolation.js';

export interface ParsedKeyframes {
  keyframes: NormalizedKeyframe[];
  unsupportedProperties: string[];
}

const SUPPORTED_DIRECT_PROPS = ['opacity', 'width', 'height', 'top', 'left', 'right', 'bottom'] as const;

const META_KEYS = new Set(['offset', 'easing', 'composite']);

const KNOWN_UNSUPPORTED = new Set([
  'backgroundColor', 'background-color',
  'color',
  'filter', 'backdropFilter',
  'clipPath', 'clip-path',
  'mask', 'maskImage',
  'boxShadow', 'textShadow',
  'borderRadius',
  'fill', 'stroke',
]);

interface RawKeyframe {
  offset: number;
  [key: string]: unknown;
}

const TRANSFORM_FN_RE = /(translateX|translateY|scale|rotate)\(([^)]+)\)/g;

export function parseRawKeyframes(raw: RawKeyframe[]): ParsedKeyframes {
  const unsupported = new Set<string>();
  const keyframes: NormalizedKeyframe[] = raw.map((kf) => {
    const properties: Record<string, number> = {};

    if (typeof kf.transform === 'string') {
      Object.assign(properties, parseTransform(kf.transform));
    }

    for (const prop of SUPPORTED_DIRECT_PROPS) {
      const v = kf[prop];
      if (v === undefined || v === null) continue;
      if (prop === 'opacity') {
        const n = parseFloat(String(v));
        if (!Number.isNaN(n)) properties.opacity = n;
      } else {
        const px = parsePxValue(String(v));
        if (px !== null) properties[prop] = px;
      }
    }

    for (const key of Object.keys(kf)) {
      if (META_KEYS.has(key)) continue;
      if (key === 'transform') continue;
      if ((SUPPORTED_DIRECT_PROPS as readonly string[]).includes(key)) continue;
      // Anything else is unsupported — known Tier-3 explicitly or unknown.
      unsupported.add(key);
    }

    return { offset: kf.offset, properties };
  });

  return { keyframes, unsupportedProperties: Array.from(unsupported) };
}

function parseTransform(transformStr: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of transformStr.matchAll(TRANSFORM_FN_RE)) {
    const fn = match[1];
    const arg = match[2].trim();
    if (fn === 'translateX' || fn === 'translateY') {
      const px = parsePxValue(arg);
      if (px !== null) out[fn] = px;
    } else if (fn === 'scale') {
      const n = parseFloat(arg);
      if (!Number.isNaN(n)) out.scale = n;
    } else if (fn === 'rotate') {
      const rad = parseRotateToRadians(arg);
      if (rad !== null) out.rotate = rad;
    }
  }
  return out;
}

function parsePxValue(s: string): number | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function parseRotateToRadians(s: string): number | null {
  const t = s.trim();
  if (t.endsWith('rad')) {
    const n = parseFloat(t.slice(0, -3));
    return Number.isNaN(n) ? null : n;
  }
  if (t.endsWith('turn')) {
    const n = parseFloat(t.slice(0, -4));
    return Number.isNaN(n) ? null : n * 2 * Math.PI;
  }
  if (t.endsWith('grad')) {
    const n = parseFloat(t.slice(0, -4));
    return Number.isNaN(n) ? null : (n * Math.PI) / 200;
  }
  const m = t.match(/^(-?\d+(?:\.\d+)?)(?:deg)?$/);
  if (m) return (parseFloat(m[1]) * Math.PI) / 180;
  return null;
}
