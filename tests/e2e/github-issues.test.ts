import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { executeAction } from '../../src/browser/actions.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = `file://${path.resolve(__dirname, 'fixtures/test-page.html')}`;

describe('Issue #1 — setViewport', () => {
  let runtime: BrowserRuntime;

  beforeAll(async () => {
    runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();
    await runtime.navigate(fixtureUrl);
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('shows mobile-only element after resizing to 390px width', async () => {
    const page = runtime.getPage();
    await executeAction(page, { type: 'setViewport', width: 390, height: 844 });
    const mobileVisible = await page.locator('[data-testid="mobile-banner"]').isVisible();
    const desktopVisible = await page.locator('[data-testid="desktop-banner"]').isVisible();
    expect(mobileVisible).toBe(true);
    expect(desktopVisible).toBe(false);
  });

  it('hides mobile-only element at 1280px width', async () => {
    const page = runtime.getPage();
    await executeAction(page, { type: 'setViewport', width: 1280, height: 720 });
    const mobileVisible = await page.locator('[data-testid="mobile-banner"]').isVisible();
    const desktopVisible = await page.locator('[data-testid="desktop-banner"]').isVisible();
    expect(mobileVisible).toBe(false);
    expect(desktopVisible).toBe(true);
  });
});

describe('Issue #2 — clickSelector visibility', () => {
  let runtime: BrowserRuntime;

  beforeAll(async () => {
    runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();
    await runtime.navigate(fixtureUrl);
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('clicks visible button when selector matches both visible and hidden elements (default visible=true)', async () => {
    const page = runtime.getPage();
    await executeAction(page, { type: 'clickSelector', selector: 'button[aria-label="Toggle theme"]' });
    // If we got here without throwing, the test passes
  });

  it('throws strict mode violation when visible=false and selector matches multiple elements', async () => {
    const page = runtime.getPage();
    await expect(
      executeAction(page, { type: 'clickSelector', selector: 'button[aria-label="Toggle theme"]', visible: false })
    ).rejects.toThrow(/strict mode violation/);
  });
});

describe('Issue #3b — console log filtering', () => {
  let runtime: BrowserRuntime;

  beforeAll(async () => {
    runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();
    await runtime.navigate(fixtureUrl);
    // Wait for console messages to be captured
    await runtime.getPage().waitForTimeout(500);
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('returns all error logs without filtering', () => {
    const logs = runtime.getConsoleLogs();
    const errors = logs.filter(l => l.type === 'error');
    expect(errors.length).toBe(2);
    expect(errors.some(l => l.text.includes('setRTLTextPlugin'))).toBe(true);
    expect(errors.some(l => l.text.includes('database connection failed'))).toBe(true);
  });

  it('excludes logs matching excludePattern', () => {
    const logs = runtime.getConsoleLogs();
    const errors = logs.filter(l => l.type === 'error');
    const re = new RegExp('setRTLTextPlugin');
    const filtered = errors.filter(l => !re.test(l.text));
    expect(filtered.length).toBe(1);
    expect(filtered[0].text).toContain('database connection failed');
  });
});
