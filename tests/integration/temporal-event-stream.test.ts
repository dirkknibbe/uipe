import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { TemporalEventStream } from '../../src/pipelines/temporal/event-stream.js';
import {
  InputCollector,
  MutationCollector,
  NetworkCollector,
  AnimationCollector,
} from '../../src/pipelines/temporal/collectors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.resolve(__dirname, '../e2e/fixtures/timeline-causality.html');
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;

describe('TemporalEventStream integration — timeline causality', () => {
  let runtime: BrowserRuntime;
  let stream: TemporalEventStream;

  beforeAll(async () => {
    runtime = new BrowserRuntime();
    await runtime.launch();
  }, 30000);

  afterAll(async () => {
    await runtime.close();
  });

  beforeEach(async () => {
    stream = new TemporalEventStream();
  });

  it('records the canonical event sequence in temporal order', async () => {
    await runtime.navigate(FIXTURE_URL);
    const page = runtime.getPage();

    // Mock the network endpoint with a deterministic 200ms delay
    await page.route('**/timeline-test-endpoint*', async (route) => {
      await new Promise(r => setTimeout(r, 200));
      await route.fulfill({ status: 200, body: '{"ok":true}', contentType: 'application/json' });
    });

    await stream.attach(page, [
      new InputCollector(),
      new MutationCollector(),
      new NetworkCollector(),
      new AnimationCollector(),
    ]);

    // Click the trigger
    await page.click('[data-testid="trigger"]');

    // Wait for the full sequence: fetch (200ms) + animation (300ms) + safety (200ms)
    await page.waitForTimeout(800);

    const events = stream.getEvents();
    const types = events.map(e => e.type);

    // Assert canonical sequence appears in order
    // (We assert *contains in order*, not strict equality, because
    //  framework-internal events may interleave.)
    const expected: typeof types = [
      'input',
      'mutation',
      'network-request',
      'animation-start',
      'network-response',
      'mutation',
      'animation-end',
    ];

    const found = matchInOrder(types, expected);
    expect(found, `Expected ${expected.join(' → ')} in order; got ${types.join(' → ')}`).toBe(true);

    // Assert all timestamps are non-negative and monotonic
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  }, 30000);

  it('clearOnNavigate=true: navigating to a new page clears the buffer', async () => {
    await runtime.navigate(FIXTURE_URL);
    const page = runtime.getPage();
    await stream.attach(page, [new InputCollector()]);

    await page.click('[data-testid="trigger"]');
    await page.waitForTimeout(100);
    expect(stream.size()).toBeGreaterThan(0);

    await page.goto('about:blank');
    await page.waitForTimeout(100);
    expect(stream.size()).toBe(0);
  }, 30000);
});

function matchInOrder<T>(haystack: T[], needles: T[]): boolean {
  let i = 0;
  for (const h of haystack) {
    if (h === needles[i]) i++;
    if (i === needles.length) return true;
  }
  return i === needles.length;
}
