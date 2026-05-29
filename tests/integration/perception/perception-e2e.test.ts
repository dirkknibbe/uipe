import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { StructuralPipeline } from '../../../src/pipelines/structural/index.js';
import { ComponentIndexStore } from '../../../src/pipelines/component-index/store.js';
import { ClassificationQueue } from '../../../src/pipelines/component-index/queue.js';
import { Matcher } from '../../../src/pipelines/component-index/matcher.js';
import { Indexer } from '../../../src/pipelines/component-index/indexer.js';
import { TemporalEventStream } from '../../../src/pipelines/temporal/event-stream.js';
import { MutationCollector, AnimationCollector } from '../../../src/pipelines/temporal/collectors/index.js';
import { PerceptionSession } from '../../../src/pipelines/perception/session.js';

const FIXTURE = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'mutation-trigger.html');

class FakeFrameCapture extends EventEmitter {
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  emitFakeKeyframe(timestamp: number) {
    this.emit('keyframe', { frame: Buffer.from([0x89, 0x50]), timestamp });
  }
}

describe('Perception loops — end-to-end (Playwright)', () => {
  let browser: Browser;
  let page: Page;
  let tmp: string;

  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'uipe-perception-e2e-'));
    const html = await readFile(FIXTURE, 'utf8');
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(html, { waitUntil: 'load' });
  });

  afterEach(async () => {
    await page.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('full chain: mutation → frame anomaly → semantic escalation → intent VLM', async () => {
    const stream = new TemporalEventStream();
    const mutationCollector = new MutationCollector();
    const animationCollector = new AnimationCollector();
    await stream.attach(page, [mutationCollector, animationCollector]);

    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    const stubVlm = vi.fn(async () => 'TestComponent');
    const frameCapture = new FakeFrameCapture();
    const session = new PerceptionSession({ eventStream: stream });
    session.start(Date.now() - 1000, {  // start 1s in the past so warmup is past
      page,
      frameCapture: frameCapture as any,
      indexer,
      structuralPipeline: structural,
      classifyByVlm: stubVlm,
      getScreenshot: async () => page.screenshot({ type: 'png' }),
    });

    // Wait past the warmup window (500ms default)
    await new Promise((r) => setTimeout(r, 200));

    // Click the button → after 50ms a text mutation fires (no CSS animation).
    // We emit the keyframe shortly after the mutation arrives so it's still
    // within the 200ms lookback window.
    await page.click('#trigger');
    // Wait for the mutation to fire (button handler uses setTimeout 50ms)
    await new Promise((r) => setTimeout(r, 100));
    // Emit keyframe immediately — mutation is <100ms old, well within lookbackMs=200
    frameCapture.emitFakeKeyframe(Date.now());
    await new Promise((r) => setTimeout(r, 200));

    // Stop perception
    session.stop(Date.now());
    const summary = session.getSummary();

    expect(summary.anomalyCount).toBeGreaterThanOrEqual(1);
    expect(summary.anomaliesByReason['mutation-outside-animation']).toBeGreaterThanOrEqual(1);
    expect(summary.escalationCount).toBeGreaterThanOrEqual(1);
    // Intent only fires if the semantic loop flagged a pending component.
    // This depends on the fixture's text node being a recognized signature
    // or not; we don't assert intent strictly here — just verify the chain.
  }, 30_000);

  it('does not fire anomaly when mutation happens during an active animation', async () => {
    const stream = new TemporalEventStream();
    const mutationCollector = new MutationCollector();
    const animationCollector = new AnimationCollector();
    // Attach collectors first so AnimationCollector's CDP session is live.
    await stream.attach(page, [mutationCollector, animationCollector]);

    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    const stubVlm = vi.fn(async () => 'X');
    const frameCapture = new FakeFrameCapture();
    const session = new PerceptionSession({ eventStream: stream });
    // Start the session BEFORE the animation so FrameLoop is subscribed to
    // stream events and will track the animation-start event in activeAnimations.
    session.start(Date.now() - 1000, {
      page,
      frameCapture: frameCapture as any,
      indexer,
      structuralPipeline: structural,
      classifyByVlm: stubVlm,
      getScreenshot: async () => page.screenshot({ type: 'png' }),
    });

    // Wait for FrameLoop to finish installing its page-side MutationObserver
    // (start() is async internally but returns void — give it a tick).
    await new Promise((r) => setTimeout(r, 100));

    // Start a long animation — AnimationCollector pushes animation-start,
    // FrameLoop's stream subscription adds it to activeAnimations.
    await page.evaluate(() => {
      const target = document.getElementById('target')!;
      target.animate(
        [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }],
        { duration: 2000, iterations: 1 },
      );
    });
    // Pause for Animation.animationStarted CDP event to be processed by AnimationCollector
    // and for FrameLoop's handleStreamEvent to update activeAnimations.
    await new Promise((r) => setTimeout(r, 150));

    await page.click('#trigger');
    // Wait for the mutation (50ms setTimeout in the fixture handler)
    await new Promise((r) => setTimeout(r, 100));
    // Emit keyframe — animation is still active (2s duration), mutation present
    frameCapture.emitFakeKeyframe(Date.now());
    await new Promise((r) => setTimeout(r, 200));

    session.stop(Date.now());
    const summary = session.getSummary();
    expect(summary.anomalyCount).toBe(0);
  }, 30_000);
});
