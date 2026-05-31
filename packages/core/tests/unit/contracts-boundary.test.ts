import { describe, it, expect } from 'vitest';
import { VISION_API_VERSION, type VisionAnalyzeRequest } from '@uipe/contracts';

describe('@uipe/contracts boundary', () => {
  it('core can import the versioned vision API contract', () => {
    expect(VISION_API_VERSION).toBe('v1');
  });

  it('VisionAnalyzeRequest shape is usable from core', () => {
    const req: VisionAnalyzeRequest = {
      apiVersion: 'v1',
      pngBase64: 'iVBORw0KGgo=',
      regions: [{ x: 0, y: 0, w: 10, h: 10 }],
    };
    expect(req.apiVersion).toBe('v1');
    expect(req.regions).toHaveLength(1);
  });
});
