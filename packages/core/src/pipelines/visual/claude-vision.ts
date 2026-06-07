import Anthropic from '@anthropic-ai/sdk';
import type { VisualElement, TextRegion, BoundingBox, VisualUnderstanding } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ClaudeVision');

export interface ClaudeVisionConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DETECT_PROMPT = `Analyze this web page screenshot. Identify all visible UI elements.

For each element return JSON with:
- label: one of "button", "input", "link", "image", "text", "icon", "dropdown", "checkbox", "radio", "select", "nav", "heading", "other"
- boundingBox: { x, y, width, height } in pixels
- text: visible text content if any (omit if none)
- confidence: 0.0-1.0

Return ONLY a JSON array. No explanation.`;

const OCR_PROMPT = `Extract all visible text from this screenshot. For each text region return:
- text: the extracted text
- boundingBox: { x, y, width, height } in pixels
- confidence: 0.0-1.0

Return ONLY a JSON array. No explanation.`;

export class ClaudeVisionProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: ClaudeVisionConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey ?? process.env.CLAUDE_API_KEY });
    this.model = config.model ?? 'claude-opus-4-6';
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async detectElements(screenshot: Buffer): Promise<VisualElement[]> {
    logger.info('Detecting elements via Claude Vision', { bytes: screenshot.length });
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } },
          { type: 'text', text: DETECT_PROMPT },
        ],
      }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseElements(text);
  }

  async extractText(screenshot: Buffer, regions?: BoundingBox[]): Promise<TextRegion[]> {
    logger.info('Extracting text via Claude Vision');
    const prompt = regions ? `${OCR_PROMPT}\n\nFocus on these regions: ${JSON.stringify(regions)}` : OCR_PROMPT;
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseTextRegions(text);
  }

  async analyze(screenshot: Buffer, detectedElements: VisualElement[]): Promise<VisualUnderstanding> {
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

    logger.info('Running visual analysis via Claude Vision', { elementCount: detectedElements.length });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        visualHierarchy: { primaryFocus: 'unknown', readingFlow: [] },
        contrastIssues: [],
        spacingIssues: [],
        affordanceIssues: [],
        stateIndicators: [],
        overallAssessment: text || 'Analysis incomplete',
      } as VisualUnderstanding;
    }

    try {
      return JSON.parse(jsonMatch[0]) as VisualUnderstanding;
    } catch {
      return {
        visualHierarchy: { primaryFocus: 'unknown', readingFlow: [] },
        contrastIssues: [],
        spacingIssues: [],
        affordanceIssues: [],
        stateIndicators: [],
        overallAssessment: text,
      } as VisualUnderstanding;
    }
  }

  private parseElements(raw: string): VisualElement[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ label: string; boundingBox: BoundingBox; text?: string; confidence: number }>;
      return parsed.map((el, i) => ({
        id: `claude-${i}`,
        label: el.label,
        confidence: el.confidence ?? 0.7,
        boundingBox: el.boundingBox,
        text: el.text,
        visualProperties: {},
      }));
    } catch (err) {
      logger.warn('Failed to parse Claude Vision element response', err);
      return [];
    }
  }

  private parseTextRegions(raw: string): TextRegion[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ text: string; boundingBox: BoundingBox; confidence: number }>;
      return parsed.map(r => ({ text: r.text, boundingBox: r.boundingBox, confidence: r.confidence ?? 0.8 }));
    } catch (err) {
      logger.warn('Failed to parse Claude Vision text response', err);
      return [];
    }
  }
}
