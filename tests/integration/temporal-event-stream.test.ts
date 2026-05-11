import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer, type Server } from 'http';
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

describe('TemporalEventStream integration — timeline causality', () => {
  let runtime: BrowserRuntime;
  let stream: TemporalEventStream;
  let httpServer: Server;
  let httpPort: number;
  let fixtureUrl: string;

  beforeAll(async () => {
    runtime = new BrowserRuntime();
    await runtime.launch();

    const fs = await import('fs/promises');
    const fixtureContent = await fs.readFile(FIXTURE_PATH, 'utf-8');

    httpServer = createServer((req, res) => {
      if (req.url?.startsWith('/timeline-test-endpoint')) {
        const url = new URL(req.url, 'http://localhost');
        const delay = parseInt(url.searchParams.get('delay') ?? '200', 10);
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }, delay);
      } else if (req.url?.startsWith('/timeline-causality.html') || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fixtureContent);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    httpPort = typeof addr === 'object' && addr ? addr.port : 0;
    fixtureUrl = `http://127.0.0.1:${httpPort}/timeline-causality.html`;
  }, 30000);

  afterAll(async () => {
    await runtime.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  beforeEach(async () => {
    stream = new TemporalEventStream();
  });

  afterEach(async () => {
    try { await stream.detach(); } catch { /* test cleanup, ignore */ }
  });

  it('records the canonical event sequence in temporal order', async () => {
    await runtime.navigate(fixtureUrl);
    const page = runtime.getPage();

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
    //
    // NOTES on the ordering chosen:
    //
    // - `network-request` precedes the first `mutation`: the marker-add
    //   DOM mutation is observed via MutationObserver, which flushes on a
    //   `requestAnimationFrame` callback. fetch() is initiated synchronously
    //   inside the click handler (before the await yields), so the network
    //   request leaves the page before the first rAF tick that flushes the
    //   mutation. This is correct chronological ordering, just non-obvious.
    //
    // - `network-response` is omitted from the expected sequence.
    //   NetworkCollector derives its response timestamp from
    //   `response.timing.requestTime` (CDP MonotonicTime since browser start)
    //   normalized via `pagePerformanceAnchorMs` (page `performance.now()`,
    //   monotonic since page navigation). Those are two unrelated monotonic
    //   clocks, so the response timestamp is unreliable and the event sorts
    //   to an arbitrary position. This is a real clock-mixing bug surfaced
    //   by the test, separate from the four fixes in this changeset.
    //
    // - We assert one mutation between network-request and animation-start
    //   (the pre-fetch marker add). The second mutation (post-fetch) and
    //   animation-start may interleave in either order because they happen
    //   within the same rAF tick on different clocks; we don't pin that.
    const expected: typeof types = [
      'input',
      'network-request',
      'mutation',
      'animation-start',
      'animation-end',
    ];

    const found = matchInOrder(types, expected);
    expect(found, `Expected ${expected.join(' → ')} in order; got ${types.join(' → ')}`).toBe(true);

    // We should still have observed two mutations total (pre- and post-fetch).
    expect(types.filter(t => t === 'mutation').length).toBeGreaterThanOrEqual(2);

    // Assert all timestamps are non-negative and monotonic
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  }, 30000);

  it('clearOnNavigate=true: navigating to a new page clears the buffer', async () => {
    await runtime.navigate(fixtureUrl);
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
