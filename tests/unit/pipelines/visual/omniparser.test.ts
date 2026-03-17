import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OmniParserAdapter } from '../../../../src/pipelines/visual/omniparser.js';

describe('OmniParserAdapter', () => {
  let adapter: OmniParserAdapter;

  beforeEach(() => {
    adapter = new OmniParserAdapter({ endpoint: 'http://localhost:8100' });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('default endpoint is http://localhost:8100', () => {
    const defaultAdapter = new OmniParserAdapter();
    // Verify by checking isAvailable calls the right URL
    vi.mocked(fetch).mockRejectedValue(new Error('refused'));
    defaultAdapter.isAvailable();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:8100/health',
      expect.any(Object),
    );
  });

  it('returns true from isAvailable when /health responds 200', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('returns false from isAvailable when endpoint is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('throws when detect is called and OmniParser is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));
    await expect(adapter.detect(Buffer.from('fake'))).rejects.toThrow('OmniParser not available');
  });

  it('detect() POSTs to /parse endpoint', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 })) // health check
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await adapter.detect(Buffer.from('fake-png'));

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[1][0]).toBe('http://localhost:8100/parse');
    expect(calls[1][1]?.method).toBe('POST');
  });

  it('converts [x1,y1,x2,y2] bbox to {x,y,width,height}', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [
          { id: 0, label: 'button', caption: 'Submit button', confidence: 0.95, bbox: [10, 20, 110, 60], interactable: true, text: 'Submit' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adapter.detect(Buffer.from('fake-png'));
    expect(result.elements[0].boundingBox).toEqual({
      x: 10,
      y: 20,
      width: 100,  // 110 - 10
      height: 40,  // 60 - 20
    });
  });

  it('maps caption to description and interactable to isInteractable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [
          { id: 0, label: 'input', caption: 'Email input field', confidence: 0.88, bbox: [10, 20, 210, 50], interactable: true, text: null },
          { id: 1, label: 'icon', caption: 'Search icon', confidence: 0.72, bbox: [300, 10, 330, 40], interactable: false, text: null },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adapter.detect(Buffer.from('fake-png'));
    expect(result.elements[0].description).toBe('Email input field');
    expect(result.elements[0].isInteractable).toBe(true);
    expect(result.elements[0].text).toBeUndefined(); // null maps to undefined
    expect(result.elements[1].description).toBe('Search icon');
    expect(result.elements[1].isInteractable).toBe(false);
  });

  it('includes annotatedScreenshot when returned by server', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [],
        annotated_image: 'base64-encoded-png-data',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adapter.detect(Buffer.from('fake-png'));
    expect(result.annotatedScreenshot).toBe('base64-encoded-png-data');
  });

  it('uses element id from V2 response', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [
          { id: 7, label: 'button', caption: 'Click me', confidence: 0.9, bbox: [0, 0, 50, 50], interactable: true, text: 'Click' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await adapter.detect(Buffer.from('fake-png'));
    expect(result.elements[0].id).toBe('omni-7');
  });
});
