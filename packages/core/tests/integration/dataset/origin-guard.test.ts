import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { startFixtureServer, type FixtureServer } from '../../e2e/fixture-server.js';
import { guardNavigations } from '../../../src/dataset/run/run-site.js';
import { TraceWriter, readTrace } from '../../../src/dataset/trace/trace-writer.js';

const LINK_STYLE = 'style="display:block;width:300px;height:40px"';

let dir: string;
let home: FixtureServer;
let other: FixtureServer;
let browser: Browser;
let page: Page;
let trace: TraceWriter;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uipe-guard-'));
  other = await startFixtureServer(dir); // another port is another origin
  home = await startFixtureServer(dir, { '/bounce': `${other.baseUrl}/index.html` });
  await writeFile(join(dir, 'index.html'), `<a id="off" ${LINK_STYLE} href="${other.baseUrl}/index.html">off</a>
    <a id="pop" ${LINK_STYLE} target="_blank" href="${home.baseUrl}/index.html">pop</a>`);
  browser = await chromium.launch();
  page = await browser.newPage();
  trace = new TraceWriter(join(dir, 'trace.jsonl'), 'r', 'h');
  await guardNavigations(page, trace, { origin: new URL(home.baseUrl).origin, robots: { status: 'ok', allowed: () => true } });
  await page.goto(`${home.baseUrl}/index.html`);
});
afterAll(async () => {
  await browser?.close();
  await home?.close(); await other?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('guardNavigations (real Chromium)', () => {
  it('a coordinate click on an off-origin link leaves the main frame on the start origin', async () => {
    const b = (await page.locator('#off').boundingBox())!;
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).origin).toBe(new URL(home.baseUrl).origin);
    await trace.flush();
    expect((await readTrace(join(dir, 'trace.jsonl'))).some((r) => r.type === 'tool-refused' && r.detail?.startsWith('off-origin'))).toBe(true);
  });

  it('a same-origin URL that 302s off-origin does not leave the explorer on the off-origin page', async () => {
    await page.goto(`${home.baseUrl}/bounce`).catch(() => undefined);
    await expect.poll(() => new URL(page.url()).origin, { timeout: 5_000 }).toBe(new URL(home.baseUrl).origin);
    await page.waitForTimeout(500); // still home once any bounce-back settles
    expect(new URL(page.url()).origin).toBe(new URL(home.baseUrl).origin);
    await trace.flush();
    expect((await readTrace(join(dir, 'trace.jsonl'))).some((r) => r.type === 'tool-refused' && r.detail?.startsWith('off-origin redirect'))).toBe(true);
  });

  it('a start URL that redirects to another site makes the guard origin throw', async () => {
    const fresh = await browser.newPage();
    const freshTrace = new TraceWriter(join(dir, 'fresh-trace.jsonl'), 'r', 'h');
    const guard = await guardNavigations(fresh, freshTrace, { origin: new URL(home.baseUrl).origin, robots: { status: 'ok', allowed: () => true } });
    await fresh.goto(`${home.baseUrl}/bounce`).catch(() => undefined);
    await expect.poll(() => { try { guard.origin(); return 'ok'; } catch (e) { return (e as Error).message; } }).toMatch(/redirected off-site/);
    expect(fresh.url()).not.toContain(other.baseUrl);
    await fresh.context().close();
  });

  it('a target=_blank popup is closed', async () => {
    const b = (await page.locator('#pop').boundingBox())!;
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.waitForTimeout(1_000);
    expect(page.context().pages()).toEqual([page]);
  });
});
