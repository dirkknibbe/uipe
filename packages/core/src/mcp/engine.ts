import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Page } from 'playwright';
import { BrowserRuntime } from '../browser/runtime.js';
import { StructuralPipeline } from '../pipelines/structural/index.js';
import { FusionEngine } from '../pipelines/fusion/index.js';
import { VisualPipeline, type VisualPipelineConfig } from '../pipelines/visual/index.js';
import { Config } from '../config.js';
import type { AnalysisDepth, SceneGraph } from '../types/index.js';
import { TemporalEventStream } from '../pipelines/temporal/event-stream.js';
import {
  InputCollector,
  NetworkCollector,
  AnimationCollector,
  MutationCollector,
} from '../pipelines/temporal/collectors/index.js';
import { FlowProducer } from '../pipelines/temporal/producers/optical-flow.js';
import { FlowCollector } from '../pipelines/temporal/collectors/optical-flow.js';
import { createLogger } from '../utils/logger.js';
import { resolveFlowBinaryPath } from '../utils/flow-binary.js';
import type { Collector } from '../pipelines/temporal/collectors/types.js';
import { ComponentIndexStore } from '../pipelines/component-index/store.js';
import { ClassificationQueue } from '../pipelines/component-index/queue.js';
import { Matcher } from '../pipelines/component-index/matcher.js';
import { Indexer } from '../pipelines/component-index/indexer.js';
import { classifyByVlm } from '../pipelines/component-index/vlm-classifier.js';

const log = createLogger('mcp-server');
const FLOW_BINARY_PATH = resolveFlowBinaryPath(
  process.env,
  dirname(fileURLToPath(import.meta.url)),
);

export interface ServerConfig {
  visual?: VisualPipelineConfig;
}

export interface Engine {
  runtime: BrowserRuntime;
  eventStream: TemporalEventStream;
  ensureLaunched(): Promise<void>;
  ensureStreamAttached(): Promise<void>;
  captureGraph(includeVisual?: boolean | AnalysisDepth): Promise<SceneGraph>;
}

/** The pipeline pieces the MCP tool handlers also reach into. Not part of the public Engine contract. */
export interface EngineInternals extends Engine {
  visual: VisualPipeline | null;
  structural: StructuralPipeline;
  componentStore: ComponentIndexStore;
  componentIndexer: Indexer;
  getFlowProducer(): FlowProducer | null;
  scheduleIdleDrain(): void;
  isLaunched(): boolean;
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function createEngine(config: ServerConfig = {}): EngineInternals {
  const runtime = new BrowserRuntime();
  const structural = new StructuralPipeline();
  const fusion = new FusionEngine();
  const visual = config.visual ? new VisualPipeline(config.visual) : null;
  const componentStore = new ComponentIndexStore();
  const componentQueue = new ClassificationQueue();
  const componentMatcher = new Matcher({ store: componentStore, queue: componentQueue });
  const componentIndexer = new Indexer({ matcher: componentMatcher });
  const eventStream = new TemporalEventStream();
  let flowProducer: FlowProducer | null = null;
  let flowCollector: FlowCollector | null = null;
  let launchPromise: Promise<void> | undefined;
  let streamAttachedTo: Page | undefined;

  async function ensureLaunched(): Promise<void> {
    if (!launchPromise) launchPromise = runtime.launch();
    return launchPromise;
  }

  async function ensureStreamAttached(): Promise<void> {
    const page = runtime.getPage();
    if (streamAttachedTo === page) return;

    const collectors: Collector[] = [
      new InputCollector(),
      new NetworkCollector(),
      new AnimationCollector(),
      new MutationCollector(),
    ];

    if (existsSync(FLOW_BINARY_PATH)) {
      if (!flowProducer || flowProducer.disabled) {
        flowProducer = new FlowProducer({ binaryPath: FLOW_BINARY_PATH });
        flowProducer.on('disabled', () => {
          log.warn('optical-flow sidecar disabled after consecutive failures', { binaryPath: FLOW_BINARY_PATH });
        });
        await flowProducer.start();
        flowCollector = new FlowCollector(flowProducer);
      }
      collectors.push(flowCollector!);
    } else {
      log.debug('optical-flow sidecar binary missing, skipping flow pipeline', { binaryPath: FLOW_BINARY_PATH });
    }

    await eventStream.attach(page, collectors);
    streamAttachedTo = page;
  }

  async function captureGraph(includeVisual: boolean | AnalysisDepth = false): Promise<SceneGraph> {
    const shouldCapture = includeVisual !== false && visual;
    const page = runtime.getPage();
    const [screenshot, nodes, scrollPosition] = await Promise.all([
      shouldCapture ? runtime.screenshot() : Promise.resolve(null),
      structural.extractStructure(page),
      page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    ]);
    let visualElements = screenshot && visual ? await visual.detectElements(screenshot) : [];
    if (screenshot && visual && typeof includeVisual === 'string') {
      const result = await visual.analyze(screenshot, includeVisual);
      visualElements = result.elements;
    }
    const origin = originOf(runtime.currentUrl());
    const componentMap = await componentIndexer.run(nodes, { origin });
    return fusion.fuse(visualElements, nodes, {
      url: runtime.currentUrl(),
      viewport: { width: Config.browser.viewportWidth, height: Config.browser.viewportHeight },
      scrollPosition,
    }, componentMap);
  }

  function scheduleIdleDrain(): void {
    if (componentQueue.size() === 0) return;
    void componentQueue.drainOnce({
      classifier: async ({ html, screenshotCrop }) => classifyByVlm({ html, screenshotCrop }),
      screenshotProvider: () => runtime.screenshot().catch(() => null),
      store: componentStore,
    });
  }

  return {
    runtime,
    eventStream,
    ensureLaunched,
    ensureStreamAttached,
    captureGraph,
    visual,
    structural,
    componentStore,
    componentIndexer,
    getFlowProducer: () => flowProducer,
    scheduleIdleDrain,
    isLaunched: () => launchPromise !== undefined,
  };
}
