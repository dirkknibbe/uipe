import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';
import { executeAction } from '../../src/browser/actions.js';
import { startFixtureServer, type FixtureServer } from './fixture-server.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

// End-to-end coverage for the url-guard security fix (mcp-1, web-1) exercised
// through the real BrowserRuntime + actions against a real http fixture origin.
describe('url-guard (e2e) — navigation scheme allowlist', () => {
  let runtime: BrowserRuntime;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer(fixturesDir);
    runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();
  });

  afterAll(async () => {
    await runtime.close();
    await server.close();
  });

  // HAPPY: a normal http navigation goes through and the page actually loads.
  it('happy path: navigates to an allowed http URL and loads the page', async () => {
    await runtime.navigate(`${server.baseUrl}/test-page.html`);
    expect(runtime.currentUrl()).toContain('127.0.0.1');
    const tree = await runtime.getAccessibilityTree();
    expect(tree.length).toBeGreaterThan(0);
  });

  // SAD: a file: URL (the local-file-read vector) is rejected before goto, so
  // a prompt-injected navigate('file:///etc/passwd') can't exfiltrate a secret.
  it('sad path: rejects a file:// URL (no local-file read)', async () => {
    await expect(runtime.navigate('file:///etc/passwd')).rejects.toThrow(/scheme not allowed/i);
  });

  // EDGE: the act tool's SEPARATE navigate goto path is guarded too — closing
  // the second choke-point the original plan missed.
  it('edge case: the act navigate action path also rejects a javascript: URL', async () => {
    await expect(
      executeAction(runtime.getPage(), { type: 'navigate', url: 'javascript:alert(1)' })
    ).rejects.toThrow(/scheme not allowed/i);
  });
});
