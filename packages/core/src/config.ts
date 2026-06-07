import 'dotenv/config';

export const Config = {
  vision: {
    provider: (process.env.VISION_PROVIDER as 'omniparser' | 'claude' | 'auto') || 'claude',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llava:7b',
    ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 300000,
    omniparserUrl: process.env.OMNIPARSER_URL || 'http://localhost:8100',
    omniparserTimeoutMs: Number(process.env.OMNIPARSER_TIMEOUT_MS) || 120000,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  frameCapture: {
    baseFps: Number(process.env.FRAME_CAPTURE_BASE_FPS) || 5,
    burstFps: Number(process.env.FRAME_CAPTURE_BURST_FPS) || 15,
    burstDurationMs: Number(process.env.FRAME_CAPTURE_BURST_DURATION_MS) || 3000,
    diffThreshold: Number(process.env.FRAME_DIFF_THRESHOLD) || 5,
    pixelDiffThreshold: Number(process.env.PIXEL_DIFF_THRESHOLD) || 0.05,
  },
  browser: {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    viewportWidth: Number(process.env.BROWSER_VIEWPORT_WIDTH) || 1280,
    viewportHeight: Number(process.env.BROWSER_VIEWPORT_HEIGHT) || 720,
  },
  temporal: {
    maxSceneGraphHistory: Number(process.env.MAX_SCENE_GRAPH_HISTORY) || 10,
    maxTransitionHistory: Number(process.env.MAX_TRANSITION_HISTORY) || 50,
  },
} as const;
