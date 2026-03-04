import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserRuntime } from '../browser/runtime.js';
import { StructuralPipeline } from '../pipelines/structural/index.js';
import { FusionEngine } from '../pipelines/fusion/index.js';
import { TemporalTracker } from '../pipelines/temporal/index.js';
import { AffordanceEngine } from '../pipelines/affordance/index.js';
import { toJSON, toCompact } from '../pipelines/fusion/serializer.js';
import { affordanceToText } from './serializer.js';

const VIEWPORT = { width: 1280, height: 720 };

export function createServer(): McpServer {
  const server = new McpServer({ name: 'ui-perception-engine', version: '0.1.0' });

  const runtime = new BrowserRuntime();
  const structural = new StructuralPipeline();
  const fusion = new FusionEngine();
  const tracker = new TemporalTracker();
  const affordance = new AffordanceEngine();
  let launchPromise: Promise<void> | undefined;

  async function ensureLaunched(): Promise<void> {
    if (!launchPromise) launchPromise = runtime.launch();
    return launchPromise;
  }

  async function captureGraph() {
    const nodes = await structural.extractStructure(runtime.getPage());
    return fusion.fuse([], nodes, {
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
      }),
    },
    async ({ url }) => {
      await ensureLaunched();
      await runtime.navigate(url);
      const graph = await captureGraph();
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
      description: 'Return the current UI scene graph. Use format="compact" for a readable tree (default) or "json" for full structured data.',
      inputSchema: z.object({
        format: z.enum(['compact', 'json']).default('compact').describe('Output format'),
      }),
    },
    async ({ format }) => {
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

  return server;
}
