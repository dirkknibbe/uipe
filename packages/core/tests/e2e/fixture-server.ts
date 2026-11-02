import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export interface FixtureServer {
  baseUrl: string;
  /** Every request path received, in order. */
  requests: string[];
  close: () => Promise<void>;
}

/**
 * Serve a fixtures directory over http://127.0.0.1:<ephemeral-port>. E2E tests
 * navigate to this instead of file:// — url-guard now blocks file: (mcp-1/web-1),
 * and http fixtures are the more faithful e2e transport (real origin + network).
 * `redirects` maps a path to a Location answered with 302 (redirect-escape tests);
 * `statuses` maps a path to a status answered with an empty body (e.g. 204).
 */
export async function startFixtureServer(
  rootDir: string, redirects: Record<string, string> = {}, statuses: Record<string, number> = {},
): Promise<FixtureServer> {
  const root = normalize(rootDir);
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url ?? '/');
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const location = redirects[pathname];
      if (location) {
        res.writeHead(302, { location });
        res.end();
        return;
      }
      if (statuses[pathname]) {
        res.writeHead(statuses[pathname]);
        res.end();
        return;
      }
      const filePath = normalize(join(root, decodeURIComponent(pathname)));
      // Refuse anything that escapes the fixtures root (no ../ traversal).
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
