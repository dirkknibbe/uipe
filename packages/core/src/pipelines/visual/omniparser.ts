import type { VisualElement } from '../../types/index.js';
import { Config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('OmniParser');

export interface OmniParserConfig {
  endpoint: string;
  timeoutMs?: number;
}

export interface OmniParserResult {
  elements: VisualElement[];
  processingTimeMs: number;
  annotatedScreenshot?: string;  // base64 PNG with bounding box overlay
}

export class OmniParserAdapter {
  private config: Required<OmniParserConfig>;

  constructor(config: OmniParserConfig = { endpoint: 'http://localhost:8100' }) {
    this.config = { timeoutMs: Config.vision.omniparserTimeoutMs, ...config };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.endpoint}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async detect(screenshot: Buffer): Promise<OmniParserResult> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(`OmniParser not available at ${this.config.endpoint}`);
    }

    const start = Date.now();
    logger.info('Sending screenshot to OmniParser', { bytes: screenshot.length });

    const formData = new FormData();
    formData.append('image', new Blob([new Uint8Array(screenshot)], { type: 'image/png' }), 'screenshot.png');

    const res = await fetch(`${this.config.endpoint}/parse`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`OmniParser error: ${res.status} ${res.statusText}`);
    }

    const raw = await res.json() as {
      elements: Array<{
        id: number;
        label: string;
        caption: string;
        confidence: number;
        bbox: [number, number, number, number];  // [x1, y1, x2, y2]
        interactable: boolean;
        text: string | null;
      }>;
      annotated_image?: string;
    };

    const elements: VisualElement[] = raw.elements.map((el) => ({
      id: `omni-${el.id}`,
      label: el.label,
      confidence: el.confidence,
      boundingBox: {
        x: el.bbox[0],
        y: el.bbox[1],
        width: el.bbox[2] - el.bbox[0],
        height: el.bbox[3] - el.bbox[1],
      },
      text: el.text ?? undefined,
      description: el.caption,
      isInteractable: el.interactable,
      visualProperties: {},
    }));

    logger.info('OmniParser detected elements', { count: elements.length });
    return {
      elements,
      processingTimeMs: Date.now() - start,
      annotatedScreenshot: raw.annotated_image,
    };
  }
}
