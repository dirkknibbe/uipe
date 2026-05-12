import { describe, it, expect, vi } from 'vitest';
import type { CDPSession } from 'playwright';
import { AnimationVerifier } from '../../../../../../src/pipelines/temporal/verifiers/animation/verifier.js';

const makeNormalizer = () => ({
  fromWallTimeMs: (n: number) => n,
  fromPerformanceNow: (n: number) => n,
  fromCdpMonotonicSeconds: (n: number) => n * 1000,
});

function makeMockCdp(responses: Record<string, unknown> = {}) {
  return {
    send: vi.fn(async (method: string) => {
      if (method in responses) return responses[method];
      throw new Error(`Unmocked CDP method: ${method}`);
    }),
  } as unknown as CDPSession;
}

const animStartParams = (overrides: any = {}) => ({
  animation: {
    id: 'anim-1',
    name: 'slide-in',
    startTime: 1.0,
    playbackRate: 1,
    source: { duration: 300, easing: 'ease-out' },
    ...overrides.animation,
  },
});

describe('AnimationVerifier.captureStart', () => {
  it('emits prediction with translateX from a simple slide animation', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 10, y: 20, w: 100, h: 50 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());

    expect(payload.animationId).toBe('anim-1');
    expect(payload.predicted).toEqual([
      { property: 'translateX', endValue: 240, unit: 'px' },
    ]);
    expect(payload.boundingBox).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(payload.skipped).toBeUndefined();
  });

  it('emits skipped:zero-duration for duration=0 animations', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    const payload = await v.captureStart(
      cdp,
      animStartParams({ animation: { source: { duration: 0 } } }),
      makeNormalizer(),
    );
    expect(payload.skipped?.reason).toBe('zero-duration');
    expect(payload.predicted).toEqual([]);
    expect(cdp.send).not.toHaveBeenCalled();
  });

  it('emits skipped:resolve-failed when resolveAnimation throws', async () => {
    const cdp = {
      send: vi.fn(async (method: string) => {
        if (method === 'Animation.resolveAnimation') throw new Error('gone');
        return undefined;
      }),
    } as unknown as CDPSession;
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('resolve-failed');
    expect(payload.predicted).toEqual([]);
    expect(payload.boundingBox).toBeNull();
  });

  it('emits skipped:no-target-node when callFunctionOn returns no bbox', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: { value: { keyframes: [], timing: { iterations: 1, direction: 'normal' }, bbox: null } },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('no-target-node');
    expect(payload.boundingBox).toBeNull();
  });

  it('emits skipped:unsupported-timing for iterations !== 1', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: Infinity, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('unsupported-timing');
    expect(payload.predicted).toEqual([]);
  });

  it('emits skipped:unsupported-only when only Tier-3 properties animate', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, backgroundColor: 'rgb(255, 0, 0)' },
              { offset: 1, backgroundColor: 'rgb(0, 255, 0)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped?.reason).toBe('unsupported-only');
    expect(payload.unsupportedProperties).toContain('backgroundColor');
  });

  it('lists unsupportedProperties when mixing Tier-1 and Tier-3 props', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)', backgroundColor: 'rgb(0,0,0)' },
              { offset: 1, transform: 'translateX(100px)', backgroundColor: 'rgb(255,255,255)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    const payload = await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(payload.skipped).toBeUndefined();
    expect(payload.predicted).toEqual([{ property: 'translateX', endValue: 100, unit: 'px' }]);
    expect(payload.unsupportedProperties).toContain('backgroundColor');
  });

  it('stores pending state only when a successful prediction is produced', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(v.hasPending('anim-1')).toBe(true);
  });

  it('does not store pending state for skipped predictions', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    await v.captureStart(
      cdp,
      animStartParams({ animation: { source: { duration: 0 } } }),
      makeNormalizer(),
    );
    expect(v.hasPending('anim-1')).toBe(false);
  });
});

describe('AnimationVerifier.observe', () => {
  const makeOkStartResponses = () => ({
    'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
    'Runtime.callFunctionOn': {
      result: {
        value: {
          keyframes: [
            { offset: 0, transform: 'translateX(0px)' },
            { offset: 1, transform: 'translateX(240px)' },
          ],
          timing: { iterations: 1, direction: 'normal' },
          bbox: { x: 0, y: 0, w: 10, h: 10 },
        },
      },
    },
  });

  it('returns deviation when both prediction and observation succeed', async () => {
    const cdp = makeMockCdp(makeOkStartResponses());
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());

    (cdp.send as any).mockImplementationOnce(async (method: string) => {
      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: { translateX: 240 } } };
      }
      return undefined;
    });

    const dev = await v.observe(cdp, 'anim-1');
    expect(dev).not.toBeNull();
    expect(dev!.score).toBe(0);
    expect(v.hasPending('anim-1')).toBe(false);
  });

  it('returns null and drops state when observation throws', async () => {
    const cdp = makeMockCdp(makeOkStartResponses());
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());

    (cdp.send as any).mockImplementationOnce(async (method: string) => {
      if (method === 'Runtime.callFunctionOn') throw new Error('detached');
      return undefined;
    });

    const dev = await v.observe(cdp, 'anim-1');
    expect(dev).toBeNull();
    expect(v.hasPending('anim-1')).toBe(false);
  });

  it('returns null when no pending state exists', async () => {
    const cdp = makeMockCdp();
    const v = new AnimationVerifier();
    const dev = await v.observe(cdp, 'never-seen');
    expect(dev).toBeNull();
  });
});

describe('AnimationVerifier.discard', () => {
  it('drops pending state for a given animationId', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    expect(v.hasPending('anim-1')).toBe(true);
    v.discard('anim-1');
    expect(v.hasPending('anim-1')).toBe(false);
  });
});

describe('AnimationVerifier.clear', () => {
  it('drops all pending state', async () => {
    const cdp = makeMockCdp({
      'Animation.resolveAnimation': { remoteObject: { objectId: 'obj-1' } },
      'Runtime.callFunctionOn': {
        result: {
          value: {
            keyframes: [
              { offset: 0, transform: 'translateX(0px)' },
              { offset: 1, transform: 'translateX(240px)' },
            ],
            timing: { iterations: 1, direction: 'normal' },
            bbox: { x: 0, y: 0, w: 10, h: 10 },
          },
        },
      },
    });
    const v = new AnimationVerifier();
    await v.captureStart(cdp, animStartParams(), makeNormalizer());
    await v.captureStart(
      cdp,
      animStartParams({ animation: { id: 'anim-2' } }),
      makeNormalizer(),
    );
    expect(v.hasPending('anim-1')).toBe(true);
    expect(v.hasPending('anim-2')).toBe(true);
    v.clear();
    expect(v.hasPending('anim-1')).toBe(false);
    expect(v.hasPending('anim-2')).toBe(false);
  });
});
