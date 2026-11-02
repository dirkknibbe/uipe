import { createHash } from 'node:crypto';
import { FrameCapture } from '../../pipelines/visual/frame-capture.js';
import { computeSignature } from '../../pipelines/component-index/fingerprint.js';
import type { StructuralNode } from '../../types/structural.js';
import type { Episode } from '../types.js';

const DEFAULT_PHASH_MAX_HAMMING = 6;
const HASH_SEP = ',';

/**
 * Animations carry no reliable link to a specific target node, so every tuple
 * includes the sorted signature set of all targets. Tuples are sorted, so
 * animation order and positional DOM ids don't matter.
 */
export function episodeFingerprint(
  episode: Episode,
  targets: StructuralNode[],
  nodeMap: ReadonlyMap<string, StructuralNode>,
): string {
  const targetSigs = targets.map((t) => computeSignature(t, nodeMap)).sort().join('+');
  const tuples = episode.animations
    .map((a) => [targetSigs, a.name ?? '', a.duration, a.delay, a.iterations, a.easing ?? ''].join('|'))
    .sort();
  return createHash('sha256').update(tuples.join('\n')).digest('hex').slice(0, 16);
}

// perceptualHash uses no instance state, so a bare FrameCapture is fine here.
const hasher = new FrameCapture();

export async function framesPHash(keyframes: Buffer[]): Promise<string> {
  const hashes = await Promise.all(keyframes.map((k) => hasher.perceptualHash(k)));
  return hashes.map((h) => h.toString(16).padStart(16, '0')).join(HASH_SEP);
}

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, d = 0;
  while (x > 0n) { d += Number(x & 1n); x >>= 1n; }
  return d;
}

function phashClose(a: string, b: string, max: number): boolean {
  const pa = a.split(HASH_SEP), pb = b.split(HASH_SEP);
  if (!a || pa.length !== pb.length) return false;
  return pa.every((h, i) => hamming(BigInt(`0x${h}`), BigInt(`0x${pb[i]}`)) <= max);
}

export class DedupIndex {
  private readonly max: number;
  private readonly byFingerprint = new Map<string, string>();
  private readonly phashes: { clipId: string; phash: string }[] = [];

  constructor(opts: { phashMaxHamming?: number } = {}) {
    this.max = opts.phashMaxHamming ?? DEFAULT_PHASH_MAX_HAMMING;
  }

  check(fingerprint: string, phash: string, motionOnly: boolean): { duplicateOf: string } | null {
    if (!motionOnly) {
      const exact = this.byFingerprint.get(fingerprint);
      return exact ? { duplicateOf: exact } : null;
    }
    // motion-only episodes have no animations, so all share one empty fingerprint: phash decides
    // ponytail: linear scan; index if kept-clip count reaches many thousands
    const hit = this.phashes.find((p) => phashClose(p.phash, phash, this.max));
    return hit ? { duplicateOf: hit.clipId } : null;
  }

  add(clipId: string, fingerprint: string, phash: string): void {
    if (!this.byFingerprint.has(fingerprint)) this.byFingerprint.set(fingerprint, clipId);
    this.phashes.push({ clipId, phash });
  }
}
