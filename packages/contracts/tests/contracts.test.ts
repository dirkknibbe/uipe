import { describe, it, expect } from 'vitest';
import { VISION_API_VERSION, type VisionAnalyzeRequest } from '../src/index.js';

describe('vision contract', () => {
  it('pins the API version', () => {
    expect(VISION_API_VERSION).toBe('v1');
  });

  it('constructs a valid analyze request', () => {
    const req: VisionAnalyzeRequest = {
      apiVersion: 'v1',
      pngBase64: 'AAAA',
      regions: [],
    };
    expect(req.regions).toEqual([]);
  });
});
