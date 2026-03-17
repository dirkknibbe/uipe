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
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { message: { content: string } };
    const content = data.message.content;

    // Strip markdown fences if present
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    logger.info('Ollama analysis complete');
    return JSON.parse(jsonStr) as VisualUnderstanding;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json() as { models?: Array<{ name: string }> };
      return data.models?.some(m => m.name.startsWith('qwen3-vl')) ?? false;
    } catch {
      return false;
    }
  }
}
