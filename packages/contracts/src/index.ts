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

export interface VisionAnalyzeRequest {
  apiVersion: typeof VISION_API_VERSION;
  /** PNG screenshot, base64-encoded (lossless — required for vision models). */
  pngBase64: string;
  /** Regions of interest to classify; empty means whole-frame. */
  regions: BBox[];
}
