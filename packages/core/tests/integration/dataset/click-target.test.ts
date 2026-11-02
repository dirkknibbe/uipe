import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { resolveClickTarget } from '../../../src/dataset/explorer/click-target.js';

const HTML = `
<style>body{margin:0} button,a,input{display:block;width:200px;height:40px;margin:0}</style>
<button id="buy" aria-label=""><svg id="icon" width="20" height="20"><rect width="20" height="20"/></svg> Buy now</button>
<form><input id="q"><button id="go">Go</button><input id="next" type="submit" value="Next"></form>
<button id="plain">Open details</button>
<a class="dup" href="#a">A</a><a class="dup" href="#b">B</a>`;

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(HTML);
});
afterAll(async () => { await browser?.close(); });

const centre = async (sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

describe('resolveClickTarget (real Chromium)', () => {
  it('an icon inside a risky button reports the button label', async () => {
    const { x, y } = await centre('#icon');
    expect(await resolveClickTarget(page, { type: 'click', x, y })).toEqual({ label: 'Buy now', submit: false });
  });

  it('clickSelector resolves the element, not the selector string', async () => {
    expect(await resolveClickTarget(page, { type: 'clickSelector', selector: '#buy' })).toMatchObject({ label: 'Buy now' });
  });

  it('flags benign-labelled submit controls inside a form', async () => {
    expect(await resolveClickTarget(page, { type: 'clickSelector', selector: '#go' })).toEqual({ label: 'Go', submit: true });
    expect(await resolveClickTarget(page, { type: 'click', ...(await centre('#next')) })).toEqual({ label: 'Next', submit: true });
    expect(await resolveClickTarget(page, { type: 'clickSelector', selector: '#plain' })).toEqual({ label: 'Open details', submit: false });
  });

  it('returns null when the target cannot be pinned to one element', async () => {
    expect(await resolveClickTarget(page, { type: 'clickSelector', selector: '.dup' })).toBeNull();
    expect(await resolveClickTarget(page, { type: 'clickSelector', selector: '#missing' })).toBeNull();
    expect(await resolveClickTarget(page, { type: 'click', x: 5000, y: 5000 })).toBeNull();
  });
});
