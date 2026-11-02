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
  home = await startFixtureServer(dir);
  other = await startFixtureServer(dir); // another port is another origin
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

  it('a target=_blank popup is closed', async () => {
    const b = (await page.locator('#pop').boundingBox())!;
    await page.mouse.click(b.x + 10, b.y + 10);
    await page.waitForTimeout(1_000);
    expect(page.context().pages()).toEqual([page]);
  });
});
