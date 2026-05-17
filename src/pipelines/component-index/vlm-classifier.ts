import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ComponentVlmClassifier');

const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const MAX_NAME_LENGTH = 40;
const HTML_TRUNCATE_AT = 500;

const PROMPT_BASE = `Reply with a single PascalCase component name for the UI element shown in the cropped screenshot. Prefer common names (Button, Card, Modal, TextInput). For custom design-system components, use the most descriptive name (e.g., 'ProductCard', 'PrimaryButton'). One word, PascalCase, no explanation.`;

const PROMPT = (html: string) =>
  html.length > 0
    ? `You are classifying a single UI component. Below is its outerHTML and a cropped screenshot of where it renders on the page.\n\nHTML:\n${html}\n\n${PROMPT_BASE}`
    : `You are classifying a single UI component shown in the cropped screenshot.\n\n${PROMPT_BASE}`;

export interface ClassifyByVlmOptions {
  html: string;
  screenshotCrop: Buffer;
  client?: Anthropic;
  model?: string;
}

/**
 * Asks Claude Vision for a PascalCase component name. Returns the validated
 * name on success, or 'Unknown' on validation failure, malformed response,
 * or network error. Never throws.
 */
export async function classifyByVlm(opts: ClassifyByVlmOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  const client = opts.client ?? new Anthropic({ apiKey });
  const model = opts.model ?? 'claude-opus-4-7';
  const html = opts.html.length > HTML_TRUNCATE_AT ? `${opts.html.slice(0, HTML_TRUNCATE_AT)}…` : opts.html;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 32,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.screenshotCrop.toString('base64') } },
          { type: 'text', text: PROMPT(html) },
        ],
      }],
    });

    const block = response.content[0];
    const raw = block && block.type === 'text' ? block.text : '';
    const trimmed = raw.trim();
    if (!trimmed) return 'Unknown';
    if (trimmed.length > MAX_NAME_LENGTH) return 'Unknown';
    if (!NAME_RE.test(trimmed)) return 'Unknown';
    return trimmed;
  } catch (err) {
    logger.warn('VLM classification failed, returning Unknown', { error: String(err) });
    return 'Unknown';
  }
}
