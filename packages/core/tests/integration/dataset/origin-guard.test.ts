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
const redirects: Record<string, string> = {};
const guardFor = (p: Page, name: string, origin = new URL(home.baseUrl).origin) => {
  const t = new TraceWriter(join(dir, `${name}.jsonl`), 'r', 'h');
  return guardNavigations(p, t, { origin, robots: { status: 'ok', allowed: () => true } }).then((guard) => ({ guard, trace: t }));
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uipe-guard-'));
  other = await startFixtureServer(dir); // another port is another origin
  home = await startFixtureServer(dir, redirects);
  const port = new URL(home.baseUrl).port;
  Object.assign(redirects, { '/bounce': `${other.baseUrl}/index.html`, '/apex': `http://www.localhost:${port}/index.html` });
  // An on-origin page that keeps navigating to a URL that 302s off-origin: an endless bounce without a cap.
  await writeFile(join(dir, 'auto.html'), `<script>location.href = '/bounce';</script>`);
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
    // The bounce skips the 2s navigation slot the /bounce request just took.
    await expect.poll(() => new URL(page.url()).origin, { timeout: 1_500 }).toBe(new URL(home.baseUrl).origin);
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
    await expect.poll(() => fresh.url()).toBe('about:blank');
    await fresh.context().close();
  });

  it('an on-origin page that keeps redirecting off-origin is bounced at most 3 times, then the run stops', async () => {
    const fresh = await browser.newPage();
    const { guard, trace: t } = await guardFor(fresh, 'loop');
    const before = other.requests.length;
    await fresh.goto(`${home.baseUrl}/auto.html`).catch(() => undefined);
    await expect.poll(() => { try { guard.origin(); return 'ok'; } catch (e) { return (e as Error).message; } }, { timeout: 20_000 })
      .toMatch(/redirect cap/);
    await expect.poll(() => fresh.url()).toBe('about:blank');
    await fresh.waitForTimeout(2_500); // no further bounce or navigation once stopped
    expect(other.requests.length - before).toBeLessThanOrEqual(3);
    expect(fresh.url()).toBe('about:blank');
    await t.flush();
    expect((await readTrace(join(dir, 'loop.jsonl'))).some((r) => r.type === 'error' && /redirect cap/.test(r.message))).toBe(true);
    await fresh.context().close();
  });

  it('an apex start URL that redirects to www canonicalises the origin and later www navigations are allowed', async () => {
    const fresh = await browser.newPage();
    const port = new URL(home.baseUrl).port;
    const { guard, trace: t } = await guardFor(fresh, 'canon', `http://localhost:${port}`);
    t.write({ type: 'run-start', step: 0 });
    await fresh.goto(`http://localhost:${port}/apex`);
    expect(guard.origin()).toBe(`http://www.localhost:${port}`);
    await fresh.goto(`http://www.localhost:${port}/index.html?next=1`);
    expect(fresh.url()).toBe(`http://www.localhost:${port}/index.html?next=1`);
    await t.flush();
    expect((await readTrace(join(dir, 'canon.jsonl'))).filter((r) => r.type === 'tool-refused')).toEqual([]);
    await fresh.context().close();
  });

  it('a target=_blank popup is closed', async () => {
    const b = (await page.locator('#pop').boundingBox())!;
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.waitForTimeout(1_000);
    expect(page.context().pages()).toEqual([page]);
  });
});
