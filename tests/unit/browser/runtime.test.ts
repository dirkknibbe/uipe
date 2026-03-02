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
});
