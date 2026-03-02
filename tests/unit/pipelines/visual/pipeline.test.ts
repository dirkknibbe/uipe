import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisualPipeline } from '../../../../src/pipelines/visual/index.js';
import { OmniParserAdapter } from '../../../../src/pipelines/visual/omniparser.js';
import { ClaudeVisionProvider } from '../../../../src/pipelines/visual/claude-vision.js';

vi.mock('../../../../src/pipelines/visual/omniparser.js');
vi.mock('../../../../src/pipelines/visual/claude-vision.js');

const fakeElements = [
  { id: 'a', label: 'button', confidence: 0.9, boundingBox: { x: 0, y: 0, width: 100, height: 40 }, visualProperties: {} },
];

describe('VisualPipeline', () => {
  beforeEach(() => {
    vi.mocked(ClaudeVisionProvider).mockImplementation(() => ({
      detectElements: vi.fn().mockResolvedValue(fakeElements),
      extractText: vi.fn().mockResolvedValue([]),
    } as unknown as ClaudeVisionProvider));
    vi.mocked(OmniParserAdapter).mockImplementation(() => ({
      isAvailable: vi.fn().mockResolvedValue(false),
      detect: vi.fn().mockResolvedValue({ elements: fakeElements, processingTimeMs: 10 }),
    } as unknown as OmniParserAdapter));
  });

  it('uses Claude Vision when provider is "claude"', async () => {
    const pipeline = new VisualPipeline({ provider: 'claude', claude: { apiKey: 'test' } });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
    expect(vi.mocked(ClaudeVisionProvider).mock.results[0].value.detectElements).toHaveBeenCalled();
  });

  it('falls back to Claude when auto and OmniParser unavailable', async () => {
    const pipeline = new VisualPipeline({
      provider: 'auto',
      omniparser: { endpoint: 'http://localhost:8000' },
      claude: { apiKey: 'test' },
    });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
  });

  it('uses OmniParser when auto and OmniParser is available', async () => {
    vi.mocked(OmniParserAdapter).mockImplementation(() => ({
      isAvailable: vi.fn().mockResolvedValue(true),
      detect: vi.fn().mockResolvedValue({ elements: fakeElements, processingTimeMs: 5 }),
    } as unknown as OmniParserAdapter));
    const pipeline = new VisualPipeline({
      provider: 'auto',
      omniparser: { endpoint: 'http://localhost:8000' },
    });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
    expect(vi.mocked(OmniParserAdapter).mock.results.at(-1)!.value.detect).toHaveBeenCalled();
  });
});
