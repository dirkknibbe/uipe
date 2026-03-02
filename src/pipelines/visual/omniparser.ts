import type { VisualElement } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('OmniParser');

export interface OmniParserConfig {
  endpoint: string;
  timeoutMs?: number;
}

export interface OmniParserResult {
  elements: VisualElement[];
  processingTimeMs: number;
}

export class OmniParserAdapter {
  private config: Required<OmniParserConfig>;

  constructor(config: OmniParserConfig) {
    this.config = { timeoutMs: 10000, ...config };
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

    const res = await fetch(`${this.config.endpoint}/detect`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`OmniParser error: ${res.status} ${res.statusText}`);
    }

    const raw = await res.json() as { elements: Array<{
      label: string;
      confidence: number;
      bbox: [number, number, number, number];
      text?: string;
    }> };

    const elements: VisualElement[] = raw.elements.map((el, i) => ({
      id: `omni-${i}`,
      label: el.label,
      confidence: el.confidence,
      boundingBox: { x: el.bbox[0], y: el.bbox[1], width: el.bbox[2], height: el.bbox[3] },
      text: el.text,
      visualProperties: {},
    }));

    logger.info('OmniParser detected elements', { count: elements.length });
    return { elements, processingTimeMs: Date.now() - start };
  }
}
