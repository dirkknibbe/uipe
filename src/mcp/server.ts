import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserRuntime } from '../browser/runtime.js';
import { StructuralPipeline } from '../pipelines/structural/index.js';
import { FusionEngine } from '../pipelines/fusion/index.js';
import { TemporalTracker } from '../pipelines/temporal/index.js';
import { AffordanceEngine } from '../pipelines/affordance/index.js';
import { VisualPipeline, type VisualPipelineConfig } from '../pipelines/visual/index.js';
import { FrameCapture } from '../pipelines/visual/frame-capture.js';
import { toJSON, toCompact } from '../pipelines/fusion/serializer.js';
import { affordanceToText } from './serializer.js';
import { Config } from '../config.js';
import type { AnalysisDepth } from '../types/index.js';

export interface ServerConfig {
  visual?: VisualPipelineConfig;
}

export const TOOL_NAMES = [
  'navigate',
  'get_scene',
  'get_affordances',
  'act',
  'get_console_logs',
  'get_network_errors',
  'get_screenshot',
  'detect_elements',
  'analyze_visual',
  'compare_states',
  'watch',
  'stop_watch',
] as const;

export function createServer(config: ServerConfig = {}): McpServer {
  const server = new McpServer({ name: 'ui-perception-engine', version: '0.1.0' });

  const runtime = new BrowserRuntime();
  const structural = new StructuralPipeline();
  const fusion = new FusionEngine();
  const tracker = new TemporalTracker();
  const affordance = new AffordanceEngine();
  const visual = config.visual ? new VisualPipeline(config.visual) : null;
  let frameCapture: FrameCapture | null = null;
  let keyframeCount = 0;
  let watchStartTime = 0;
  let launchPromise: Promise<void> | undefined;

  async function ensureLaunched(): Promise<void> {
    if (!launchPromise) launchPromise = runtime.launch();
    return launchPromise;
  }

  async function captureGraph(includeVisual: boolean | AnalysisDepth = false) {
    const shouldCapture = includeVisual !== false && visual;
    const [screenshot, nodes] = await Promise.all([
      shouldCapture ? runtime.screenshot() : Promise.resolve(null),
      structural.extractStructure(runtime.getPage()),
    ]);
    let visualElements = screenshot && visual ? await visual.detectElements(screenshot) : [];
    if (screenshot && visual && typeof includeVisual === 'string') {
      const result = await visual.analyze(screenshot, includeVisual);
      visualElements = result.elements;
    }
    return fusion.fuse(visualElements, nodes, {
      url: runtime.currentUrl(),
      viewport: { width: Config.browser.viewportWidth, height: Config.browser.viewportHeight },
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
      inputSchema: z.object({
        type: z.enum(['click', 'clickSelector', 'type', 'scroll', 'hover', 'wait', 'navigate', 'back', 'pressKey'])
          .describe('Action type to execute'),
        x: z.number().optional().describe('X coordinate (for click, hover)'),
        y: z.number().optional().describe('Y coordinate (for click, hover)'),
        selector: z.string().optional().describe('CSS selector (for clickSelector, type)'),
        text: z.string().optional().describe('Text to type (for type action)'),
        direction: z.enum(['up', 'down']).optional().describe('Scroll direction (for scroll)'),
        amount: z.number().optional().describe('Scroll amount in pixels (for scroll)'),
        ms: z.number().optional().describe('Wait duration in milliseconds (for wait)'),
        url: z.string().optional().describe('URL to navigate to (for navigate)'),
        key: z.string().optional().describe('Key to press (for pressKey, e.g. "Enter", "Escape")'),
      }),
    },
    async (input) => {
      await ensureLaunched();
      await runtime.executeAction(input as import('../types/browser-actions.js').BrowserAction);
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

  // Tool 8: detect_elements
  server.registerTool(
    'detect_elements',
    {
      title: 'Detect UI Elements',
      description: 'Run OmniParser detection only (Tier A — fast, structured). Returns detected UI elements with bounding boxes and labels. Optionally navigate to a URL first.',
      inputSchema: z.object({
        url: z.string().optional().describe('Optional URL to navigate to before detecting'),
      }),
    },
    async ({ url }) => {
      await ensureLaunched();
      if (url) await runtime.navigate(url);
      if (!visual) {
        return { content: [{ type: 'text' as const, text: 'Visual pipeline not configured. Pass visual config to createServer().' }] };
      }
      const screenshot = await runtime.screenshot();
      const result = await visual.analyze(screenshot, 'detect');
      const text = result.elements.length === 0
        ? 'No elements detected.'
        : result.elements.map(el =>
            `[${el.label}] "${el.description ?? el.text ?? ''}" conf=${el.confidence.toFixed(2)} at (${el.boundingBox.x},${el.boundingBox.y},${el.boundingBox.width}x${el.boundingBox.height})${el.isInteractable ? ' [interactive]' : ''}`
          ).join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // Tool 9: analyze_visual
  server.registerTool(
    'analyze_visual',
    {
      title: 'Analyze Visual Quality',
      description: 'Run Ollama/Qwen3-VL visual understanding (Tier B) on the current page. Returns visual hierarchy, contrast issues, spacing, affordance issues, and overall UX assessment. Requires Ollama running with qwen3-vl model.',
      inputSchema: z.object({}),
    },
    async () => {
      await ensureLaunched();
      if (!visual) {
        return { content: [{ type: 'text' as const, text: 'Visual pipeline not configured. Pass visual config to createServer().' }] };
      }
      const screenshot = await runtime.screenshot();
      const result = await visual.analyze(screenshot, 'understand');
      if (!result.analysis) {
        return { content: [{ type: 'text' as const, text: 'Visual analysis unavailable. Ensure Ollama is running with a vision model (e.g. llava:7b).' }] };
      }
      const a = result.analysis;
      const vh = a.visualHierarchy ?? { primaryFocus: 'unknown', readingFlow: [] };
      const lines = [
        `Visual Hierarchy: primary focus = "${vh.primaryFocus}", flow = ${(vh.readingFlow ?? []).join(' → ')}`,
        '',
        `Contrast Issues (${(a.contrastIssues ?? []).length}):`,
        ...(a.contrastIssues ?? []).map(c => `  - ${c.element}: ${c.issue}${c.estimatedRatio ? ` (ratio: ${c.estimatedRatio})` : ''}`),
        '',
        `Spacing Issues (${(a.spacingIssues ?? []).length}):`,
        ...(a.spacingIssues ?? []).map(s => `  - ${s.area}: ${s.issue}`),
        '',
        `Affordance Issues (${(a.affordanceIssues ?? []).length}):`,
        ...(a.affordanceIssues ?? []).map(af => `  - ${af.element}: ${af.issue}`),
        '',
        `State Indicators (${(a.stateIndicators ?? []).length}):`,
        ...(a.stateIndicators ?? []).map(s => `  - [${s.type}] ${s.element}: ${s.description}`),
        '',
        `Overall: ${a.overallAssessment ?? 'No assessment available'}`,
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // Tool 10: compare_states
  server.registerTool(
    'compare_states',
    {
      title: 'Compare Scene States',
      description: 'Re-capture the current scene graph and compare it to the previous state. Returns a diff summary showing what changed.',
      inputSchema: z.object({}),
    },
    async () => {
      await ensureLaunched();
      const graph = await captureGraph();
      const transition = tracker.observe(graph);
      if (!transition) {
        return { content: [{ type: 'text' as const, text: 'First observation recorded. Call again to compare against this state.' }] };
      }
      const d = transition.diff;
      const lines = [
        `Transition: ${transition.type}`,
        `  Added: ${d.added.length} nodes`,
        `  Removed: ${d.removed.length} nodes`,
        `  Modified: ${d.modified.length} nodes`,
        `  Stable: ${d.stable.length} nodes`,
      ];
      if (d.modified.length > 0) {
        lines.push('', 'Changes:');
        for (const mod of d.modified.slice(0, 10)) {
          for (const c of mod.changes) {
            lines.push(`  ${mod.nodeId}: ${c.field} "${String(c.from)}" → "${String(c.to)}"`);
          }
        }
        if (d.modified.length > 10) {
          lines.push(`  ... and ${d.modified.length - 10} more`);
        }
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // Tool 11: watch
  server.registerTool(
    'watch',
    {
      title: 'Watch for Visual Changes',
      description: 'Start real-time keyframe capture on the current page. Emits keyframes when significant visual changes are detected. Call stop_watch to stop.',
      inputSchema: z.object({}),
    },
    async () => {
      if (!launchPromise) {
        return { content: [{ type: 'text' as const, text: 'No browser session. Call navigate first.' }] };
      }
      if (frameCapture?.capturing) {
        return { content: [{ type: 'text' as const, text: 'Already watching. Call stop_watch first.' }] };
      }
      frameCapture = new FrameCapture();
      keyframeCount = 0;
      watchStartTime = Date.now();

      frameCapture.on('keyframe', async () => {
        keyframeCount++;
        try {
          const graph = await captureGraph();
          tracker.observe(graph);
        } catch {
          // Silently skip — frame capture continues
        }
      });

      await frameCapture.start(runtime.getPage());
      return { content: [{ type: 'text' as const, text: 'Watching page for visual changes. Call stop_watch to stop and get summary.' }] };
    },
  );

  // Tool 12: stop_watch
  server.registerTool(
    'stop_watch',
    {
      title: 'Stop Watching',
      description: 'Stop real-time keyframe capture and return a summary of what was captured.',
      inputSchema: z.object({}),
    },
    async () => {
      if (!frameCapture || !frameCapture.capturing) {
        return { content: [{ type: 'text' as const, text: 'Not currently watching. Call watch first.' }] };
      }
      await frameCapture.stop();
      const durationMs = Date.now() - watchStartTime;
      const history = tracker.getHistory();
      const transitionTypes = history.slice(-keyframeCount)
        .map(t => t.type)
        .filter((v, i, a) => a.indexOf(v) === i);

      const lines = [
        `Watch stopped.`,
        `  Duration: ${(durationMs / 1000).toFixed(1)}s`,
        `  Keyframes captured: ${keyframeCount}`,
        `  Total frames processed: ${frameCapture.totalFrames}`,
        `  Transition types observed: ${transitionTypes.length > 0 ? transitionTypes.join(', ') : 'none'}`,
      ];
      frameCapture = null;
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  return server;
}
