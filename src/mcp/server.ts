import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserRuntime } from '../browser/runtime.js';
import { StructuralPipeline } from '../pipelines/structural/index.js';
import { FusionEngine } from '../pipelines/fusion/index.js';
import { TemporalTracker } from '../pipelines/temporal/index.js';
import { AffordanceEngine } from '../pipelines/affordance/index.js';
import { VisualPipeline, type VisualPipelineConfig } from '../pipelines/visual/index.js';
import { toJSON, toCompact } from '../pipelines/fusion/serializer.js';
import { affordanceToText } from './serializer.js';

export interface ServerConfig {
  visual?: VisualPipelineConfig;
}

const VIEWPORT = { width: 1280, height: 720 };

export const TOOL_NAMES = [
  'navigate',
  'get_scene',
  'get_affordances',
  'act',
  'get_console_logs',
  'get_network_errors',
  'get_screenshot',
] as const;

export function createServer(config: ServerConfig = {}): McpServer {
  const server = new McpServer({ name: 'ui-perception-engine', version: '0.1.0' });

  const runtime = new BrowserRuntime();
  const structural = new StructuralPipeline();
  const fusion = new FusionEngine();
  const tracker = new TemporalTracker();
  const affordance = new AffordanceEngine();
  const visual = config.visual ? new VisualPipeline(config.visual) : null;
  let launchPromise: Promise<void> | undefined;

  async function ensureLaunched(): Promise<void> {
    if (!launchPromise) launchPromise = runtime.launch();
    return launchPromise;
  }

  async function captureGraph(includeVisual = false) {
    const [screenshot, nodes] = await Promise.all([
      includeVisual && visual ? runtime.screenshot() : Promise.resolve(null),
      structural.extractStructure(runtime.getPage()),
    ]);
    const visualElements = screenshot && visual ? await visual.detectElements(screenshot) : [];
    return fusion.fuse(visualElements, nodes, {
      url: runtime.currentUrl(),
      viewport: VIEWPORT,
      scrollPosition: { x: 0, y: 0 },
    });
  }

  // Tool 1: navigate
  server.registerTool(
    'navigate',
    {
      title: 'Navigate to URL',
      description: 'Navigate to a URL and return the UI scene graph as compact text. Always call this first before using other tools.',
      inputSchema: z.object({
        url: z.string().describe('The URL to navigate to'),
        visual: z.boolean().default(false).describe('Enable Claude Vision to detect visual elements (canvas, maps, charts). Requires ANTHROPIC_API_KEY.'),
      }),
    },
    async ({ url, visual: includeVisual }) => {
      await ensureLaunched();
      await runtime.navigate(url);
      const graph = await captureGraph(includeVisual);
      const transition = tracker.observe(graph);
      let text = toCompact(graph);
      if (transition) {
        text += `\n\n[Transition: ${transition.type}, +${transition.diff.added.length} -${transition.diff.removed.length} ~${transition.diff.modified.length}]`;
      }
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 2: get_scene
  server.registerTool(
    'get_scene',
    {
      title: 'Get Current Scene',
      description: 'Return the current UI scene graph. Use format="compact" for a readable tree (default) or "json" for full structured data. Set visual=true to re-capture with Claude Vision analysis.',
      inputSchema: z.object({
        format: z.enum(['compact', 'json']).default('compact').describe('Output format'),
        visual: z.boolean().default(false).describe('Re-capture scene with Claude Vision visual detection enabled'),
      }),
    },
    async ({ format, visual: includeVisual }) => {
      if (includeVisual) {
        await ensureLaunched();
        const graph = await captureGraph(true);
        const transition = tracker.observe(graph);
        let text = format === 'json' ? toJSON(graph) : toCompact(graph);
        if (transition) {
          text += `\n\n[Transition: ${transition.type}]`;
        }
        return { content: [{ type: 'text' as const, text }] };
      }
      const latest = tracker.getLatest();
      if (!latest) {
        return { content: [{ type: 'text' as const, text: 'No scene captured yet. Call navigate first.' }] };
      }
      const text = format === 'json' ? toJSON(latest) : toCompact(latest);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 3: get_affordances
  server.registerTool(
    'get_affordances',
    {
      title: 'Get UI Affordances',
      description: 'Return interactive elements and their predicted outcomes, ranked by priority. Use minPriority="high" to focus on the most important elements.',
      inputSchema: z.object({
        minPriority: z.enum(['high', 'medium', 'low']).default('medium').describe('Minimum priority to include'),
      }),
    },
    async ({ minPriority }) => {
      const latest = tracker.getLatest();
      if (!latest) {
        return { content: [{ type: 'text' as const, text: 'No scene captured yet. Call navigate first.' }] };
      }
      const history = tracker.getHistory();
      const map = affordance.analyze(latest, history);
      const text = affordanceToText(map, minPriority);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 4: act
  server.registerTool(
    'act',
    {
      title: 'Execute Browser Action',
      description: 'Execute an action in the browser. After execution the scene is re-captured and returned along with any detected UI transition.',
      inputSchema: z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.number(), y: z.number() }),
        z.object({ type: z.literal('clickSelector'), selector: z.string() }),
        z.object({ type: z.literal('type'), text: z.string(), selector: z.string().optional() }),
        z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), amount: z.number().optional() }),
        z.object({ type: z.literal('hover'), x: z.number(), y: z.number() }),
        z.object({ type: z.literal('wait'), ms: z.number() }),
        z.object({ type: z.literal('navigate'), url: z.string() }),
        z.object({ type: z.literal('back') }),
        z.object({ type: z.literal('pressKey'), key: z.string() }),
      ]),
    },
    async (input) => {
      await ensureLaunched();
      await runtime.executeAction(input);
      const graph = await captureGraph();
      const transition = tracker.observe(graph);
      let text = `Action executed: ${input.type}\n\n` + toCompact(graph);
      if (transition) {
        text += `\n\n[Transition: ${transition.type}]`;
      }
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 5: get_console_logs
  server.registerTool(
    'get_console_logs',
    {
      title: 'Get Console Logs',
      description: 'Return browser console messages captured since the last navigate. Use type="error" to see only errors, "warning" for warnings, or "all" for everything.',
      inputSchema: z.object({
        type: z.enum(['error', 'warning', 'log', 'info', 'all']).default('all').describe('Filter by console message type'),
      }),
    },
    async ({ type }) => {
      if (!launchPromise) {
        return { content: [{ type: 'text' as const, text: 'No browser session. Call navigate first.' }] };
      }
      const logs = runtime.getConsoleLogs();
      const filtered = type === 'all' ? logs : logs.filter(l => l.type === type);
      if (filtered.length === 0) {
        return { content: [{ type: 'text' as const, text: `No ${type === 'all' ? '' : type + ' '}console messages captured.` }] };
      }
      const text = filtered.map(l => `[${l.type.toUpperCase()}] ${l.text}`).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 6: get_screenshot
  server.registerTool(
    'get_screenshot',
    {
      title: 'Get Screenshot',
      description: 'Capture a screenshot of the current page and return it as an image. Use this to visually inspect canvas elements (maps, charts, WebGL), verify layout, or see anything the scene graph cannot describe.',
      inputSchema: z.object({}),
    },
    async () => {
      await ensureLaunched();
      const buf = await runtime.screenshot();
      return {
        content: [{
          type: 'image' as const,
          data: buf.toString('base64'),
          mimeType: 'image/png',
        }],
      };
    },
  );

  // Tool 7: get_network_errors
  server.registerTool(
    'get_network_errors',
    {
      title: 'Get Network Errors',
      description: 'Return failed network requests captured since the last navigate — includes HTTP errors (4xx, 5xx) and connection-level failures (DNS, refused, CORS blocked).',
      inputSchema: z.object({}),
    },
    async () => {
      if (!launchPromise) {
        return { content: [{ type: 'text' as const, text: 'No browser session. Call navigate first.' }] };
      }
      const errors = runtime.getNetworkErrors();
      if (errors.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No failed network requests captured.' }] };
      }
      const text = errors.map(e => {
        const status = e.statusCode ? ` [${e.statusCode}]` : '';
        return `[FAILED${status}] ${e.method} ${e.url}\n  Error: ${e.errorText}`;
      }).join('\n\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  return server;
}
