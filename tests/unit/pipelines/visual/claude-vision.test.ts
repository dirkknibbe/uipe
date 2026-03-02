import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeVisionProvider } from '../../../../src/pipelines/visual/claude-vision.js';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('@anthropic-ai/sdk');

const mockCreate = vi.fn();

beforeEach(() => {
  vi.mocked(Anthropic).mockImplementation(() => ({
    messages: { create: mockCreate },
  } as unknown as Anthropic));
  mockCreate.mockReset();
});

describe('ClaudeVisionProvider', () => {
  it('detectElements parses Claude JSON response into VisualElement[]', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { label: 'button', boundingBox: { x: 10, y: 20, width: 100, height: 40 }, text: 'Click me', confidence: 0.9 },
        { label: 'input', boundingBox: { x: 10, y: 80, width: 200, height: 30 }, confidence: 0.85 },
      ])}],
    });
    const provider = new ClaudeVisionProvider({ apiKey: 'test-key' });
    const elements = await provider.detectElements(Buffer.from('fake-png'));
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ label: 'button', text: 'Click me', confidence: 0.9 });
    expect(elements[0].id).toMatch(/^claude-/);
  });

  it('detectElements returns empty array on malformed response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'I cannot analyze this.' }] });
    const provider = new ClaudeVisionProvider({ apiKey: 'test-key' });
    expect(await provider.detectElements(Buffer.from('fake'))).toEqual([]);
  });

  it('extractText parses text regions', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { text: 'Hello World', boundingBox: { x: 0, y: 0, width: 100, height: 20 }, confidence: 0.95 },
      ])}],
    });
    const provider = new ClaudeVisionProvider({ apiKey: 'test-key' });
    const regions = await provider.extractText(Buffer.from('fake-png'));
    expect(regions).toHaveLength(1);
    expect(regions[0].text).toBe('Hello World');
  });

  it('detectElements extracts JSON embedded in prose', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Here are the elements:\n[{"label":"link","boundingBox":{"x":5,"y":5,"width":50,"height":20},"confidence":0.8}]' }],
    });
    const provider = new ClaudeVisionProvider({ apiKey: 'test-key' });
    const elements = await provider.detectElements(Buffer.from('fake'));
    expect(elements).toHaveLength(1);
    expect(elements[0].label).toBe('link');
  });
});
