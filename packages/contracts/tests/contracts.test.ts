import { describe, it, expect } from 'vitest';
import { VISION_API_VERSION, type VisionAnalyzeRequest } from '../src/index.js';
import {
  visionAnalyzeResponseSchema,
  visionAnalyzeRequestSchema,
} from '../src/schema.js';

describe('vision contract', () => {
  it('pins the API version', () => {
    expect(VISION_API_VERSION).toBe('v1');
  });

  it('constructs a valid analyze request', () => {
    const req: VisionAnalyzeRequest = { api_version: 'v1', png_base64: 'AAAA', regions: [] };
    expect(req.regions).toEqual([]);
  });
});

describe('vision /v1 zod schemas', () => {
  it('accepts a well-formed ok response', () => {
    const ok = {
      api_version: 'v1',
      request_id: 'r1',
      status: 'ok',
      elements: [{ label: 'button', confidence: 0.9, bbox: { x: 1, y: 2, w: 3, h: 4 } }],
      model_id: 'qwen2.5-vl-7b',
      latency_ms: 1200,
    };
    expect(() => visionAnalyzeResponseSchema.parse(ok)).not.toThrow();
  });

  it('rejects a non-ok response with no reason (discriminator invariant)', () => {
    const bad = {
      api_version: 'v1', request_id: 'r1', status: 'degraded',
      elements: [], model_id: 'qwen2.5-vl-7b', latency_ms: 5,
    };
    expect(() => visionAnalyzeResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a request with a bad api_version', () => {
    expect(() => visionAnalyzeRequestSchema.parse({
      api_version: 'v2', png_base64: 'AAAA', regions: [],
    })).toThrow();
  });
});
