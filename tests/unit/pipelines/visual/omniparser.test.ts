import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OmniParserAdapter } from '../../../../src/pipelines/visual/omniparser.js';

describe('OmniParserAdapter', () => {
  let adapter: OmniParserAdapter;

  beforeEach(() => {
    adapter = new OmniParserAdapter({ endpoint: 'http://localhost:8000' });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns false from isAvailable when endpoint is down', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('returns true from isAvailable when endpoint is healthy', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('throws when detect is called and OmniParser is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));
    await expect(adapter.detect(Buffer.from('fake'))).rejects.toThrow('OmniParser not available');
  });

  it('parses OmniParser response into VisualElement[]', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [
          { label: 'button', confidence: 0.95, bbox: [10, 20, 100, 40], text: 'Submit' },
          { label: 'input', confidence: 0.88, bbox: [10, 80, 200, 30] },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adapter.detect(Buffer.from('fake-png'));
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toMatchObject({
      label: 'button',
      confidence: 0.95,
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
      text: 'Submit',
    });
    expect(result.elements[1].text).toBeUndefined();
  });
});
