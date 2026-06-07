import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemporalEventStream } from '../../src/pipelines/temporal/event-stream.js';
import { AnimationCollector } from '../../src/pipelines/temporal/collectors/animation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_HTML = readFileSync(resolve(__dirname, 'fixtures/animation-page.html'), 'utf-8');

describe('AnimationVerifier — Playwright integration', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let stream: TemporalEventStream;
  let collector: AnimationCollector;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.setContent(FIXTURE_HTML);
    stream = new TemporalEventStream();
    collector = new AnimationCollector();
    await stream.attach(page, [collector]);
  });

  afterEach(async () => {
    // stream.detach() unsubscribes the framenavigated handler AND calls
    // collector.detach() on each registered collector — so calling both
    // would be a double-detach. Use stream.detach() as the single entry.
    await stream?.detach();
    await context?.close();
  });

  // The 400ms wait covers a 200ms animation + 16ms verifier setTimeout slack
  // + ~observation roundtrip. Don't drop this below ~300ms or the
  // animation-end event may not be on the stream when we query.

  it('predicts and verifies a translateX animation', async () => {
    await page.evaluate(() => {
      document.getElementById('slide')!.classList.add('running');
    });

    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const start = events.find((e) => e.type === 'animation-start');
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    expect(start).toBeDefined();
    expect(prediction).toBeDefined();
    expect(end).toBeDefined();

    const pred = prediction!.payload as any;
    expect(pred.predicted).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'translateX', endValue: 200, unit: 'px' }),
    ]));
    expect(pred.boundingBox).toBeTruthy();
    expect(pred.skipped).toBeUndefined();

    const endPayload = end!.payload as any;
    expect(endPayload.reason).toBe('completed');
    expect(endPayload.deviation).toBeDefined();
    expect(endPayload.deviation.score).toBeLessThan(0.05);
  }, 10000);

  it('predicts and verifies an opacity fade', async () => {
    await page.evaluate(() => {
      document.getElementById('fade')!.classList.add('running');
    });
    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    const pred = prediction!.payload as any;
    expect(pred.predicted).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'opacity', endValue: 1, unit: 'scalar' }),
    ]));

    const endPayload = end!.payload as any;
    expect(endPayload.deviation.score).toBeLessThan(0.05);
  }, 10000);

  it('skips a background-color-only animation with reason unsupported-only', async () => {
    await page.evaluate(() => {
      document.getElementById('bg')!.classList.add('running');
    });
    await page.waitForTimeout(400);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');
    const end = events.find((e) => e.type === 'animation-end');

    expect(prediction).toBeDefined();
    expect(end).toBeDefined();

    const pred = prediction!.payload as any;
    expect(pred.skipped?.reason).toBe('unsupported-only');
    expect(pred.predicted).toEqual([]);
    expect(pred.unsupportedProperties).toEqual(expect.arrayContaining(['backgroundColor']));

    const endPayload = end!.payload as any;
    expect(endPayload.deviation).toBeUndefined();
  }, 10000);

  it('skips an infinite spinner with reason unsupported-timing', async () => {
    await page.evaluate(() => {
      document.getElementById('spinner')!.classList.add('running');
    });
    await page.waitForTimeout(200);

    const events = stream.getEvents();
    const prediction = events.find((e) => e.type === 'animation-prediction');

    const pred = prediction!.payload as any;
    expect(pred.skipped?.reason).toBe('unsupported-timing');
    expect(pred.predicted).toEqual([]);
  }, 10000);
});
