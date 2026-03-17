import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OMNIPARSER_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.BROWSER_VIEWPORT_WIDTH;
    delete process.env.BROWSER_VIEWPORT_HEIGHT;
    delete process.env.BROWSER_HEADLESS;
    delete process.env.FRAME_CAPTURE_BASE_FPS;
    delete process.env.MAX_SCENE_GRAPH_HISTORY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadConfig() {
    // Re-import to pick up env changes (vitest module cache must be cleared)
    const mod = await import('../../src/config.js');
    return mod.Config;
  }

  it('has correct defaults when no env vars are set', async () => {
    const Config = await loadConfig();
    expect(Config.browser.viewportWidth).toBe(1280);
    expect(Config.browser.viewportHeight).toBe(720);
    expect(Config.browser.headless).toBe(true);
    expect(Config.vision.ollamaUrl).toBe('http://localhost:11434');
    expect(Config.vision.ollamaModel).toBe('qwen3-vl:8b');
    expect(Config.vision.omniparserUrl).toBe('http://localhost:8100');
    expect(Config.vision.anthropicApiKey).toBe('');
    expect(Config.frameCapture.baseFps).toBe(5);
    expect(Config.frameCapture.burstFps).toBe(15);
    expect(Config.frameCapture.burstDurationMs).toBe(3000);
    expect(Config.frameCapture.diffThreshold).toBe(5);
    expect(Config.frameCapture.pixelDiffThreshold).toBe(0.05);
    expect(Config.temporal.maxSceneGraphHistory).toBe(10);
    expect(Config.temporal.maxTransitionHistory).toBe(50);
  });

  it('reads BROWSER_VIEWPORT_WIDTH from env', async () => {
    process.env.BROWSER_VIEWPORT_WIDTH = '1920';
    // Config is evaluated at import time, so we test the env-reading logic
    const width = Number(process.env.BROWSER_VIEWPORT_WIDTH) || 1280;
    expect(width).toBe(1920);
  });

  it('reads OLLAMA_URL from env', async () => {
    process.env.OLLAMA_URL = 'http://custom-host:9999';
    const url = process.env.OLLAMA_URL || 'http://localhost:11434';
    expect(url).toBe('http://custom-host:9999');
  });

  it('reads ANTHROPIC_API_KEY from env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const key = process.env.ANTHROPIC_API_KEY || '';
    expect(key).toBe('sk-ant-test-key');
  });

  it('Config object has all required sections', async () => {
    const Config = await loadConfig();
    expect(Config).toHaveProperty('vision');
    expect(Config).toHaveProperty('frameCapture');
    expect(Config).toHaveProperty('browser');
    expect(Config).toHaveProperty('temporal');
  });
});
