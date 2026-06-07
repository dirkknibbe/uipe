import type { VisualElement, VisualUnderstanding } from '../../types/index.js';
import { Config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('OllamaVision');

export interface OllamaVisionConfig {
  baseUrl?: string;
  model?: string;
}

export class OllamaVisionClient {
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaVisionConfig = {}) {
    this.baseUrl = config.baseUrl ?? Config.vision.ollamaUrl;
    this.model = config.model ?? Config.vision.ollamaModel;
  }

  async analyze(
    screenshot: Buffer,
    detectedElements: VisualElement[],
  ): Promise<VisualUnderstanding> {
    const screenshotBase64 = screenshot.toString('base64');

    const elementSummary = detectedElements
      .map(el => `- [${el.label}] "${el.description ?? el.text ?? ''}" at (${el.boundingBox.x},${el.boundingBox.y})`)
      .join('\n');

    const prompt = `You are a UI/UX perception engine analyzing a webpage screenshot.
OmniParser has already detected these interactive elements:
${elementSummary}

Analyze the screenshot and provide:
1. VISUAL HIERARCHY: What draws the eye first? What's the reading flow?
2. CONTRAST & READABILITY: Any text with poor contrast? Estimate WCAG compliance.
3. SPACING & ALIGNMENT: Are elements properly aligned? Any cramped or awkward spacing?
4. INTERACTIVE AFFORDANCES: Do interactive elements look clickable/tappable? Any ambiguous elements?
5. STATE INDICATORS: Loading states, error states, disabled states visible?
6. OVERALL UX ASSESSMENT: One-paragraph human-perception summary of this page.

Respond in JSON format:
{
  "visualHierarchy": { "primaryFocus": "...", "readingFlow": ["...", "..."] },
  "contrastIssues": [{ "element": "...", "issue": "...", "estimatedRatio": "..." }],
  "spacingIssues": [{ "area": "...", "issue": "..." }],
  "affordanceIssues": [{ "element": "...", "issue": "..." }],
  "stateIndicators": [{ "type": "...", "element": "...", "description": "..." }],
  "overallAssessment": "..."
}`;

    logger.info('Sending screenshot to Ollama', { model: this.model, elementCount: detectedElements.length });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'user',
          content: prompt,
          images: [screenshotBase64],
        }],
        stream: false,
        options: {
          temperature: 0.3,
          num_ctx: 8192,
          num_predict: 2048,
        },
      }),
      signal: AbortSignal.timeout(Config.vision.ollamaTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { message: { content: string; thinking?: string } };
    // Qwen3-VL uses thinking mode by default — content may be empty while thinking has the analysis
    const rawContent = data.message.content || data.message.thinking || '';

    // Strip markdown fences and <think> tags if present
    const cleaned = rawContent
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in Ollama response, returning raw analysis');
      return {
        visualHierarchy: { primaryFocus: 'unknown', readingFlow: [] },
        contrastIssues: [],
        spacingIssues: [],
        affordanceIssues: [],
        stateIndicators: [],
        overallAssessment: cleaned || 'Analysis incomplete — model may need more generation tokens on CPU',
      } as VisualUnderstanding;
    }

    logger.info('Ollama analysis complete');
    try {
      return JSON.parse(jsonMatch[0]) as VisualUnderstanding;
    } catch {
      logger.warn('Ollama returned malformed JSON, returning raw text as assessment');
      return {
        visualHierarchy: { primaryFocus: 'unknown', readingFlow: [] },
        contrastIssues: [],
        spacingIssues: [],
        affordanceIssues: [],
        stateIndicators: [],
        overallAssessment: cleaned,
      } as VisualUnderstanding;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json() as { models?: Array<{ name: string }> };
      const targetModel = this.model.split(':')[0];
      return data.models?.some(m => m.name.startsWith(targetModel)) ?? false;
    } catch {
      return false;
    }
  }
}
