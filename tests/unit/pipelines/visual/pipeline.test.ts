import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisualPipeline } from '../../../../src/pipelines/visual/index.js';
import { OmniParserAdapter } from '../../../../src/pipelines/visual/omniparser.js';
import { ClaudeVisionProvider } from '../../../../src/pipelines/visual/claude-vision.js';
import { OllamaVisionClient } from '../../../../src/pipelines/visual/ollama-vision.js';
import type { VisualUnderstanding } from '../../../../src/types/index.js';

vi.mock('../../../../src/pipelines/visual/omniparser.js');
vi.mock('../../../../src/pipelines/visual/claude-vision.js');
vi.mock('../../../../src/pipelines/visual/ollama-vision.js');

const fakeElements = [
  { id: 'a', label: 'button', confidence: 0.9, boundingBox: { x: 0, y: 0, width: 100, height: 40 }, visualProperties: {} },
];

const fakeUnderstanding: VisualUnderstanding = {
  visualHierarchy: { primaryFocus: 'hero', readingFlow: ['header', 'hero'] },
  contrastIssues: [],
  spacingIssues: [],
  affordanceIssues: [],
  stateIndicators: [],
  overallAssessment: 'Good layout.',
};

describe('VisualPipeline', () => {
  beforeEach(() => {
    vi.mocked(ClaudeVisionProvider).mockImplementation(() => ({
      detectElements: vi.fn().mockResolvedValue(fakeElements),
      extractText: vi.fn().mockResolvedValue([{ text: 'hello', boundingBox: { x: 0, y: 0, width: 50, height: 20 }, confidence: 0.9 }]),
    } as unknown as ClaudeVisionProvider));

    vi.mocked(OmniParserAdapter).mockImplementation(() => ({
      isAvailable: vi.fn().mockResolvedValue(false),
      detect: vi.fn().mockResolvedValue({ elements: fakeElements, processingTimeMs: 10 }),
    } as unknown as OmniParserAdapter));

    vi.mocked(OllamaVisionClient).mockImplementation(() => ({
      healthCheck: vi.fn().mockResolvedValue(false),
      analyze: vi.fn().mockResolvedValue(fakeUnderstanding),
    } as unknown as OllamaVisionClient));
  });

  // --- Existing backward-compat tests ---

  it('uses Claude Vision when provider is "claude"', async () => {
    const pipeline = new VisualPipeline({ provider: 'claude', claude: { apiKey: 'test' } });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
    expect(vi.mocked(ClaudeVisionProvider).mock.results[0].value.detectElements).toHaveBeenCalled();
  });

  it('falls back to Claude when auto and OmniParser unavailable', async () => {
    const pipeline = new VisualPipeline({
      provider: 'auto',
      omniparser: { endpoint: 'http://localhost:8100' },
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
      omniparser: { endpoint: 'http://localhost:8100' },
    });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
    expect(vi.mocked(OmniParserAdapter).mock.results.at(-1)!.value.detect).toHaveBeenCalled();
  });

  // --- Three-tier analyze tests ---

  it('analyze with detect depth calls only OmniParser, returns analysis: null', async () => {
    const pipeline = new VisualPipeline({ provider: 'claude' });
    const result = await pipeline.analyze(Buffer.from('img'), 'detect');
    expect(result.elements).toEqual(fakeElements);
    expect(result.analysis).toBeNull();
    expect(result.deepAnalysis).toBeNull();
    // Ollama should NOT have been called
    expect(vi.mocked(OllamaVisionClient).mock.results[0].value.healthCheck).not.toHaveBeenCalled();
  });

  it('analyze with understand depth calls detection + Ollama', async () => {
    vi.mocked(OllamaVisionClient).mockImplementation(() => ({
      healthCheck: vi.fn().mockResolvedValue(true),
      analyze: vi.fn().mockResolvedValue(fakeUnderstanding),
    } as unknown as OllamaVisionClient));

    const pipeline = new VisualPipeline({ provider: 'claude' });
    const result = await pipeline.analyze(Buffer.from('img'), 'understand');
    expect(result.elements).toEqual(fakeElements);
    expect(result.analysis).toEqual(fakeUnderstanding);
    expect(result.deepAnalysis).toBeNull();
  });

  it('analyze with deep depth calls all three tiers', async () => {
    const mockExtractText = vi.fn().mockResolvedValue([{ text: 'hello', boundingBox: { x: 0, y: 0, width: 50, height: 20 }, confidence: 0.9 }]);
    vi.mocked(ClaudeVisionProvider).mockImplementation(() => ({
      detectElements: vi.fn().mockResolvedValue(fakeElements),
      extractText: mockExtractText,
    } as unknown as ClaudeVisionProvider));
    vi.mocked(OllamaVisionClient).mockImplementation(() => ({
      healthCheck: vi.fn().mockResolvedValue(true),
      analyze: vi.fn().mockResolvedValue(fakeUnderstanding),
    } as unknown as OllamaVisionClient));

    const pipeline = new VisualPipeline({ provider: 'claude' });
    const result = await pipeline.analyze(Buffer.from('img'), 'deep');
    expect(result.elements).toEqual(fakeElements);
    expect(result.analysis).toEqual(fakeUnderstanding);
    expect(result.deepAnalysis).not.toBeNull();
    expect(mockExtractText).toHaveBeenCalled();
  });

  it('skips Ollama when unavailable (returns analysis: null)', async () => {
    // Default mock has healthCheck returning false
    const pipeline = new VisualPipeline({ provider: 'claude' });
    const result = await pipeline.analyze(Buffer.from('img'), 'understand');
    expect(result.analysis).toBeNull();
    // Should not throw
  });

  it('detectElements backward compat returns just elements', async () => {
    const pipeline = new VisualPipeline({ provider: 'claude' });
    const elements = await pipeline.detectElements(Buffer.from('img'));
    expect(elements).toEqual(fakeElements);
    expect(Array.isArray(elements)).toBe(true);
  });
});
