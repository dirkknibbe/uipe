import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BoundingBox, Viewport } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('BrowserRuntime');

export interface BrowserRuntimeOptions {
  headless?: boolean;
  viewport?: Viewport;
}

export interface ElementRect {
  selector: string;
  tag: string;
  boundingBox: BoundingBox;
}

export class BrowserRuntime {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: Required<BrowserRuntimeOptions>;

  constructor(options: BrowserRuntimeOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      viewport: options.viewport ?? { width: 1280, height: 720 },
    };
  }

  async launch(): Promise<void> {
    logger.info('Launching browser');
    this.browser = await chromium.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext({ viewport: this.options.viewport });
    this.page = await this.context.newPage();
    logger.info('Browser ready');
  }

  private get activePage(): Page {
    if (!this.page) throw new Error('Browser not launched. Call launch() first.');
    return this.page;
  }

  currentUrl(): string {
    return this.activePage.url();
  }

  async navigate(url: string): Promise<void> {
    logger.info('Navigating', { url });
    await this.activePage.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async screenshot(): Promise<Buffer> {
    const buf = await this.activePage.screenshot({ type: 'png' });
    logger.debug('Screenshot captured', { bytes: buf.length });
    return buf;
  }

  async getAccessibilityTree(): Promise<string> {
    return this.activePage.locator('body').ariaSnapshot();
  }

  async getBoundingBoxes(): Promise<ElementRect[]> {
    return this.activePage.evaluate(() => {
      const results: Array<{ selector: string; tag: string; boundingBox: { x: number; y: number; width: number; height: number } }> = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom < 0 || rect.right < 0) continue;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.classList.length > 0 ? `.${el.classList[0]}` : '';
        results.push({
          selector: `${tag}${id}${cls}`,
          tag,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }
      return results;
    });
  }

  async getComputedStyles(selector: string): Promise<Record<string, string>> {
    return this.activePage.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return {};
      const styles = window.getComputedStyle(el);
      const result: Record<string, string> = {};
      for (const prop of Array.from(styles)) {
        result[prop] = styles.getPropertyValue(prop);
      }
      return result;
    }, selector);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      logger.info('Browser closed');
    }
  }
}
