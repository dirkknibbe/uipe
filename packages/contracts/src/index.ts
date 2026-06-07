/**
 * Shared API contract between session-host (consumer) and vision-svc (producer).
 * Seeded in Phase 1 to lock the cross-package boundary; fleshed out in Phase 2
 * when vision-svc is built.
 */
export const VISION_API_VERSION = 'v1' as const;

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisionElement {
  label: string;
  confidence: number;       // 0–1
  bbox: BBox;
  text?: string;
  is_interactable?: boolean;
  description?: string;
}

export type VisionStatus = 'ok' | 'warming' | 'degraded';
export type VisionReason =
  | 'model_loading'
  | 'inference_timeout'
  | 'inference_error'
  | 'unreachable';

export interface VisionAnalyzeRequest {
  api_version: typeof VISION_API_VERSION;
  png_base64: string;
  regions: BBox[];
  request_id?: string;
}

export interface VisionAnalyzeResponse {
  api_version: typeof VISION_API_VERSION;
  request_id: string;
  status: VisionStatus;
  elements: VisionElement[];
  model_id: string;
  latency_ms: number;
  reason?: VisionReason;
  retry_after_ms?: number;
  message?: string;
}

export interface VisionError {
  api_version: typeof VISION_API_VERSION;
  request_id: string;
  error: { code: string; message: string };
}
