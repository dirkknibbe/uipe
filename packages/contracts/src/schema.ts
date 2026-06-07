import { z } from 'zod';

export const bboxSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});

export const visionElementSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: bboxSchema,
  text: z.string().optional(),
  is_interactable: z.boolean().optional(),
  description: z.string().optional(),
});

export const visionStatusSchema = z.enum(['ok', 'warming', 'degraded']);
export const visionReasonSchema = z.enum([
  'model_loading', 'inference_timeout', 'inference_error', 'unreachable',
]);

export const visionAnalyzeRequestSchema = z.object({
  api_version: z.literal('v1'),
  png_base64: z.string(),
  regions: z.array(bboxSchema),
  request_id: z.string().optional(),
});

export const visionAnalyzeResponseSchema = z
  .object({
    api_version: z.literal('v1'),
    request_id: z.string(),
    status: visionStatusSchema,
    elements: z.array(visionElementSchema),
    model_id: z.string(),
    latency_ms: z.number(),
    reason: visionReasonSchema.optional(),
    retry_after_ms: z.number().optional(),
    message: z.string().optional(),
  })
  .refine((r) => r.status === 'ok' || r.reason !== undefined, {
    message: 'reason is required when status is not ok',
    path: ['reason'],
  });

export const visionErrorSchema = z.object({
  api_version: z.literal('v1'),
  request_id: z.string(),
  error: z.object({ code: z.string(), message: z.string() }),
});
