import { describe, it, expect, vi } from 'vitest';
import { classifyByVlm } from '../../../../src/pipelines/component-index/vlm-classifier.js';

function mkClient(textResponse: string | Error) {
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        if (textResponse instanceof Error) throw textResponse;
        return { content: [{ type: 'text', text: textResponse }] };
      }),
    },
  };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('classifyByVlm', () => {
  it('returns a clean PascalCase classification on happy path', async () => {
    const client = mkClient('ProductCard');
    const result = await classifyByVlm({ html: '<div/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('ProductCard');
  });

  it('trims whitespace around the response', async () => {
    const client = mkClient('  PrimaryButton \n');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('PrimaryButton');
  });

  it('returns Unknown when response is lowercase / non-PascalCase', async () => {
    const client = mkClient('button');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response has spaces (multi-word)', async () => {
    const client = mkClient('Primary Button');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response is empty', async () => {
    const client = mkClient('');
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown when response is > 40 chars', async () => {
    const client = mkClient('A'.repeat(41));
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('returns Unknown on network error', async () => {
    const client = mkClient(new Error('network'));
    const result = await classifyByVlm({ html: '<button/>', screenshotCrop: PNG, client: client as any });
    expect(result).toBe('Unknown');
  });

  it('truncates outerHTML in the request to ~500 chars', async () => {
    const client = mkClient('Button');
    const longHtml = 'a'.repeat(2000);
    await classifyByVlm({ html: longHtml, screenshotCrop: PNG, client: client as any });
    const call = client.messages.create.mock.calls[0][0];
    const textPart = call.messages[0].content.find((p: any) => p.type === 'text');
    expect(textPart.text.length).toBeLessThan(1000);
    expect(textPart.text).toContain('a'.repeat(100)); // still has a useful chunk
  });
});
