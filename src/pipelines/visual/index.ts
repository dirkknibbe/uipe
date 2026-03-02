import type { VisualElement, TextRegion, BoundingBox } from '../../types/index.js';
import { OmniParserAdapter, type OmniParserConfig } from './omniparser.js';
import { ClaudeVisionProvider, type ClaudeVisionConfig } from './claude-vision.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('VisualPipeline');

export type VisionProvider = 'omniparser' | 'claude' | 'auto';

export interface VisualPipelineConfig {
  provider?: VisionProvider;
  omniparser?: OmniParserConfig;
  claude?: ClaudeVisionConfig;
}

export class VisualPipeline {
  private omniParser?: OmniParserAdapter;
  private claudeVision: ClaudeVisionProvider;
  private provider: VisionProvider;

  constructor(config: VisualPipelineConfig = {}) {
    this.provider = config.provider ?? 'auto';
    this.claudeVision = new ClaudeVisionProvider(config.claude);
    if (config.omniparser) {
      this.omniParser = new OmniParserAdapter(config.omniparser);
    }
  }

  async detectElements(screenshot: Buffer): Promise<VisualElement[]> {
    logger.info('Detecting elements', { provider: this.provider });

    if (this.provider === 'omniparser' && this.omniParser) {
      return (await this.omniParser.detect(screenshot)).elements;
    }

    if (this.provider === 'auto' && this.omniParser) {
      if (await this.omniParser.isAvailable()) {
        logger.info('Using OmniParser (available)');
        return (await this.omniParser.detect(screenshot)).elements;
      }
      logger.info('OmniParser unavailable, falling back to Claude Vision');
    }

    return this.claudeVision.detectElements(screenshot);
  }

  async extractText(screenshot: Buffer, regions?: BoundingBox[]): Promise<TextRegion[]> {
    return this.claudeVision.extractText(screenshot, regions);
  }
}
