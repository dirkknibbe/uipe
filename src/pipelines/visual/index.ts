import type { VisualElement, TextRegion, BoundingBox, AnalysisDepth, VisualAnalysis } from '../../types/index.js';
import { OmniParserAdapter, type OmniParserConfig } from './omniparser.js';
import { ClaudeVisionProvider, type ClaudeVisionConfig } from './claude-vision.js';
import { OllamaVisionClient, type OllamaVisionConfig } from './ollama-vision.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('VisualPipeline');

export type VisionProvider = 'omniparser' | 'claude' | 'auto';

export interface VisualPipelineConfig {
  provider?: VisionProvider;
  omniparser?: OmniParserConfig;
  claude?: ClaudeVisionConfig;
  ollama?: OllamaVisionConfig;
}

export class VisualPipeline {
  private omniParser?: OmniParserAdapter;
  private claudeVision: ClaudeVisionProvider;
  private ollamaVision: OllamaVisionClient;
  private provider: VisionProvider;

  constructor(config: VisualPipelineConfig = {}) {
    this.provider = config.provider ?? 'auto';
    this.claudeVision = new ClaudeVisionProvider(config.claude);
    this.ollamaVision = new OllamaVisionClient(config.ollama);
    if (config.omniparser) {
      this.omniParser = new OmniParserAdapter(config.omniparser);
    }
  }

  async analyze(screenshot: Buffer, depth: AnalysisDepth = 'understand'): Promise<VisualAnalysis> {
    logger.info('Analyzing screenshot', { depth, provider: this.provider });

    // Tier A: Detection (OmniParser or Claude fallback)
    const elements = await this.detectElements(screenshot);

    if (depth === 'detect') {
      return { elements, analysis: null, deepAnalysis: null };
    }

    // Tier B: Understanding (Ollama/Qwen3-VL)
    let analysis = null;
    if (depth === 'understand' || depth === 'deep') {
      try {
        const ollamaAvailable = await this.ollamaVision.healthCheck();
        if (ollamaAvailable) {
          logger.info('Running Ollama visual understanding');
          analysis = await this.ollamaVision.analyze(screenshot, elements);
        } else {
          logger.info('Ollama unavailable, skipping understanding tier');
        }
      } catch (err) {
        logger.warn('Ollama analysis failed, skipping', { error: String(err) });
      }
    }

    if (depth === 'understand') {
      return { elements, analysis, deepAnalysis: null };
    }

    // Tier C: Deep analysis (Claude Vision)
    let deepAnalysis = null;
    try {
      logger.info('Running Claude Vision deep analysis');
      const regions = await this.claudeVision.extractText(screenshot);
      deepAnalysis = regions.map(r => `[${r.text}]`).join(' ');
    } catch (err) {
      logger.warn('Claude Vision deep analysis failed', { error: String(err) });
    }

    return { elements, analysis, deepAnalysis };
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
