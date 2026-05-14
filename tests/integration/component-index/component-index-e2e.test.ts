import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StructuralPipeline } from '../../../src/pipelines/structural/index.js';
import { ComponentIndexStore } from '../../../src/pipelines/component-index/store.js';
import { ClassificationQueue } from '../../../src/pipelines/component-index/queue.js';
import { Matcher } from '../../../src/pipelines/component-index/matcher.js';
import { Indexer } from '../../../src/pipelines/component-index/indexer.js';

const FIXTURE = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'five-components.html');
const ORIGIN = 'http://localhost-fixture';

describe('Component Index — end-to-end (Playwright)', () => {
  let browser: Browser;
  let page: Page;
  let tmp: string;

  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-e2e-'));
    const html = await readFile(FIXTURE, 'utf8');
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(html, { waitUntil: 'load' });
  });

  afterEach(async () => {
    await page.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('first pass classifies semantic components via rules; second pass hits everything from cache', async () => {
    const structural = new StructuralPipeline();
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    const matcher = new Matcher({ store, queue });
    const indexer = new Indexer({ matcher });

    // ─── First pass ──────────────────────────────────────────────────────
    const nodes1 = await structural.extractStructure(page);
    const map1 = await indexer.run(nodes1, { origin: ORIGIN });

    const fields1 = Array.from(map1.values());
    const resolved1 = fields1.filter((f) => f.name !== null);
    const pending1 = fields1.filter((f) => f.name === null);

    // The 3 semantic components (button, input, a[href]) classify via rules.
    expect(resolved1.length).toBeGreaterThanOrEqual(3);
    // Both custom divs (.product-card, .hero-banner) sit in pending.
    expect(pending1.length).toBeGreaterThanOrEqual(2);

    // ─── VLM drain: stub the classifier to return deterministic names ────
    const stubClassifier = vi.fn()
      .mockResolvedValueOnce('ProductCard')
      .mockResolvedValueOnce('HeroBanner');
    const stubScreenshot = vi.fn(async () => page.screenshot({ type: 'png' }));

    await queue.drainOnce({
      classifier: stubClassifier as any,
      screenshotProvider: stubScreenshot,
      store,
    });

    // ─── Second pass ─────────────────────────────────────────────────────
    const nodes2 = await structural.extractStructure(page);
    const { map: map2, hits, misses } = await indexer.runAndGetStats(nodes2, { origin: ORIGIN });

    const fields2 = Array.from(map2.values());
    const resolved2 = fields2.filter((f) => f.name !== null);
    const pending2 = fields2.filter((f) => f.name === null);

    // Every qualifying node hits a cached entry on pass 2.
    expect(pending2).toHaveLength(0);
    expect(resolved2.length).toBe(fields2.length);

    // Hit rate for the second pass should be very high (close to 1.0).
    const hitRate2 = hits / (hits + misses);
    expect(hitRate2).toBeGreaterThanOrEqual(0.95);

    // The previously-pending entries now exist on disk with VLM classifications.
    const index = await store.load(ORIGIN);
    const vlmEntries = Object.values(index.entries).filter((e) => e.classificationSource === 'vlm');
    expect(vlmEntries.map((e) => e.classification).sort()).toEqual(['HeroBanner', 'ProductCard']);
  }, 30_000);

  it('handles a missing screenshot provider gracefully during drain', async () => {
    const store = new ComponentIndexStore({ baseDir: tmp });
    const queue = new ClassificationQueue();
    queue.enqueue({ origin: ORIGIN, signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const stubClassifier = vi.fn(async () => 'X');
    await queue.drainOnce({
      classifier: stubClassifier as any,
      screenshotProvider: async () => null,
      store,
    });

    // Provider returned null → no classification attempted, no persistence.
    expect(stubClassifier).not.toHaveBeenCalled();
    const index = await store.load(ORIGIN);
    expect(Object.keys(index.entries)).toEqual([]);
  });
});
