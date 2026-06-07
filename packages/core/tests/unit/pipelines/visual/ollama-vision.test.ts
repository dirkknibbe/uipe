import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaVisionClient } from '../../../../src/pipelines/visual/ollama-vision.js';
import type { VisualElement, VisualUnderstanding } from '../../../../src/types/index.js';

const sampleUnderstanding: VisualUnderstanding = {
  visualHierarchy: { primaryFocus: 'hero banner', readingFlow: ['header', 'hero', 'content'] },
  contrastIssues: [],
  spacingIssues: [],
  affordanceIssues: [],
  stateIndicators: [],
  overallAssessment: 'Clean layout with good hierarchy.',
};

const sampleElements: VisualElement[] = [
  {
    id: 'omni-0',
    label: 'button',
    confidence: 0.95,
    boundingBox: { x: 10, y: 20, width: 100, height: 40 },
    description: 'Submit button',
    isInteractable: true,
    visualProperties: {},
  },
];

describe('OllamaVisionClient', () => {
  let client: OllamaVisionClient;

  beforeEach(() => {
    client = new OllamaVisionClient({ baseUrl: 'http://localhost:11434', model: 'qwen3-vl:8b' });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('healthCheck returns true when Ollama reports qwen3-vl model', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'qwen3-vl:8b', size: 8000000000 }],
    }), { status: 200 }));

    expect(await client.healthCheck()).toBe(true);
  });

  it('healthCheck returns false when Ollama is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));
    expect(await client.healthCheck()).toBe(false);
  });

  it('healthCheck returns false when model not found', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'llama3:8b' }],
    }), { status: 200 }));

    expect(await client.healthCheck()).toBe(false);
  });

  it('analyze sends correct request format', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify(sampleUnderstanding) },
    }), { status: 200 }));

    await client.analyze(Buffer.from('fake-png'), sampleElements);

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.model).toBe('qwen3-vl:8b');
    expect(body.stream).toBe(false);
    expect(body.messages[0].images).toHaveLength(1);
    expect(body.messages[0].images[0]).toBe(Buffer.from('fake-png').toString('base64'));
    expect(body.options.temperature).toBe(0.3);
  });

  it('analyze parses clean JSON response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify(sampleUnderstanding) },
    }), { status: 200 }));

    const result = await client.analyze(Buffer.from('fake-png'), sampleElements);
    expect(result.visualHierarchy.primaryFocus).toBe('hero banner');
    expect(result.overallAssessment).toContain('hierarchy');
  });

  it('analyze handles markdown-fenced JSON response', async () => {
    const fencedContent = '```json\n' + JSON.stringify(sampleUnderstanding) + '\n```';
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      message: { content: fencedContent },
    }), { status: 200 }));

    const result = await client.analyze(Buffer.from('fake-png'), sampleElements);
    expect(result.visualHierarchy.primaryFocus).toBe('hero banner');
  });

  it('analyze throws on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }));
    await expect(client.analyze(Buffer.from('fake'), sampleElements)).rejects.toThrow('Ollama error: 500');
  });
});
