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
  close: () => Promise<void>;
}

/**
 * Serve a fixtures directory over http://127.0.0.1:<ephemeral-port>. E2E tests
 * navigate to this instead of file:// — url-guard now blocks file: (mcp-1/web-1),
 * and http fixtures are the more faithful e2e transport (real origin + network).
 */
export async function startFixtureServer(rootDir: string): Promise<FixtureServer> {
  const root = normalize(rootDir);
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
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
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
