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
