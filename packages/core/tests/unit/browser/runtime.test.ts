import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRuntime } from '../../../src/browser/runtime.js';

describe('BrowserRuntime', () => {
  let runtime: BrowserRuntime;

  beforeEach(() => {
    runtime = new BrowserRuntime({ headless: true, viewport: { width: 1280, height: 720 } });
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('launches and closes without error', async () => {
    await runtime.launch();
  });

  it('navigates to a URL', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    const url = runtime.currentUrl();
    expect(url).toBe('https://example.com/');
  });

  it('takes a screenshot returning a Buffer', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    const buf = await runtime.screenshot();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('returns accessibility tree as a string', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    const tree = await runtime.getAccessibilityTree();
    expect(typeof tree).toBe('string');
    expect(tree.length).toBeGreaterThan(0);
  });

  it('returns bounding boxes for visible elements', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    const boxes = await runtime.getBoundingBoxes();
    expect(Array.isArray(boxes)).toBe(true);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes[0]).toMatchObject({
      selector: expect.any(String),
      boundingBox: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    });
  });

  it('executes a navigate action', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    await runtime.executeAction({ type: 'navigate', url: 'https://example.org' });
    expect(runtime.currentUrl()).toContain('example.org');
  });

  it('executes a scroll action without throwing', async () => {
    await runtime.launch();
    await runtime.navigate('https://example.com');
    await expect(
      runtime.executeAction({ type: 'scroll', direction: 'down', amount: 100 })
    ).resolves.not.toThrow();
  });

  it('captures console error messages', async () => {
    await runtime.launch();
    await runtime.navigate('data:text/html,<script>console.error("test-error-msg")</script>');
    // give the page a moment to emit the console event
    await new Promise(r => setTimeout(r, 100));
    const logs = runtime.getConsoleLogs();
    expect(logs.length).toBeGreaterThan(0);
    const err = logs.find(l => l.type === 'error');
    expect(err).toBeDefined();
    expect(err!.text).toContain('test-error-msg');
  });

  it('captures console warning messages', async () => {
    await runtime.launch();
    await runtime.navigate('data:text/html,<script>console.warn("test-warn-msg")</script>');
    await new Promise(r => setTimeout(r, 100));
    const logs = runtime.getConsoleLogs();
    const warn = logs.find(l => l.type === 'warning');
    expect(warn).toBeDefined();
    expect(warn!.text).toContain('test-warn-msg');
  });

  it('captures failed network requests (connection-level)', async () => {
    await runtime.launch();
    // image pointing at a port nothing is listening on → requestfailed
    await runtime.navigate(
      'data:text/html,<img src="http://localhost:19999/nope.png">'
    );
    await new Promise(r => setTimeout(r, 500));
    const errors = runtime.getNetworkErrors();
    const connError = errors.find(e => e.url.includes('localhost:19999'));
    expect(connError).toBeDefined();
    expect(connError!.statusCode).toBeUndefined();
  });

  it('captures HTTP error responses (4xx/5xx)', async () => {
    await runtime.launch();
    const page = runtime.getPage();
    // Intercept a route to reliably return 404
    await page.route('**/test-404-resource', route =>
      route.fulfill({ status: 404, body: 'Not Found' })
    );
    await runtime.navigate('https://example.com');
    runtime.clearLogs();
    // Trigger a fetch that returns 404 via our intercepted route
    await page.evaluate(() => fetch('/test-404-resource').catch(() => {}));
    await new Promise(r => setTimeout(r, 200));
    const errors = runtime.getNetworkErrors();
    const httpError = errors.find(e => e.statusCode === 404);
    expect(httpError).toBeDefined();
    expect(httpError!.errorText).toContain('404');
  });

  it('clears captured logs', async () => {
    await runtime.launch();
    await runtime.navigate('data:text/html,<script>console.error("x")</script>');
    await new Promise(r => setTimeout(r, 100));
    runtime.clearLogs();
    expect(runtime.getConsoleLogs()).toHaveLength(0);
    expect(runtime.getNetworkErrors()).toHaveLength(0);
  });

  it('caps console logs at MAX_LOG_ENTRIES', async () => {
    await runtime.launch();
    // Generate many console messages
    const script = Array.from({ length: 120 }, (_, i) => `console.log("msg-${i}")`).join(';');
    await runtime.navigate(`data:text/html,<script>${script}</script>`);
    await new Promise(r => setTimeout(r, 200));
    const logs = runtime.getConsoleLogs();
    expect(logs.length).toBeLessThanOrEqual(1000);
  });
});
