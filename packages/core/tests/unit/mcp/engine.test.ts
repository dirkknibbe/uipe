import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer, createServerWithEngine, TOOL_NAMES } from '../../../src/mcp/server.js';
import { createEngine } from '../../../src/mcp/engine.js';
import { StructuralPipeline } from '../../../src/pipelines/structural/index.js';
import { BrowserRuntime } from '../../../src/browser/runtime.js';
import { TemporalEventStream } from '../../../src/pipelines/temporal/event-stream.js';

afterEach(() => vi.restoreAllMocks());

describe('createServerWithEngine', () => {
  it('exposes the five Engine members', () => {
    const { server, engine } = createServerWithEngine();
    expect(server).toBeInstanceOf(McpServer);
    expect(engine.runtime).toBeInstanceOf(BrowserRuntime);
    expect(engine.eventStream).toBeInstanceOf(TemporalEventStream);
    expect(typeof engine.ensureLaunched).toBe('function');
    expect(typeof engine.ensureStreamAttached).toBe('function');
    expect(typeof engine.captureGraph).toBe('function');
  });
});

describe('createServer', () => {
  it('still returns an McpServer and TOOL_NAMES is unchanged', () => {
    expect(createServer()).toBeInstanceOf(McpServer);
    expect(TOOL_NAMES).toEqual([
      'navigate', 'get_scene', 'get_affordances', 'act', 'get_console_logs',
      'get_network_errors', 'get_screenshot', 'detect_elements', 'analyze_visual',
      'compare_states', 'watch', 'stop_watch', 'get_timeline', 'get_component_index',
      'start_perception', 'stop_perception', 'get_perception_session',
    ]);
  });
});

describe('Engine.captureGraph', () => {
  it('reads the real scroll position from the page', async () => {
    const engine = createEngine();
    const page = { evaluate: vi.fn().mockResolvedValue({ x: 0, y: 840 }) };
    vi.spyOn(engine.runtime, 'getPage').mockReturnValue(page as never);
    vi.spyOn(engine.runtime, 'currentUrl').mockReturnValue('http://localhost:1234/');
    vi.spyOn(StructuralPipeline.prototype, 'extractStructure').mockResolvedValue([]);

    const graph = await engine.captureGraph();

    expect(graph.scrollPosition).toEqual({ x: 0, y: 840 });
  });
});
