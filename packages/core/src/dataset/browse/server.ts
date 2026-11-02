import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetRoot, LocalClipStore } from '../store/clip-store.js';
import { readTrace } from '../trace/trace-writer.js';
import type { Clip } from '../types.js';

const HANDCHECK_SIZE = 40;
const DEFAULT_SEED = 'handcheck';
const MAX_BODY = 4096;
const SAFE_ID = /^[\w.-]+$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jsonl': 'text/plain', '.md': 'text/plain',
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const readJson = async <T>(path: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
};

function runIdOf(raw: string): string {
  const id = decodeURIComponent(raw);
  if (!SAFE_ID.test(id) || id === '.' || id === '..') throw new HttpError(400, 'bad run id');
  return id;
}

/** mulberry32 seeded from an FNV-1a hash of the seed string. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleIds(ids: string[], n: number, seed: string): string[] {
  const out = [...ids].sort();
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid json'); }
}

export async function startBrowseServer(opts: { root?: string; port?: number }): Promise<{ url: string; close(): Promise<void> }> {
  const root = opts.root ?? datasetRoot();
  const store = new LocalClipStore(root);
  const runsDir = join(root, 'runs');
  const here = dirname(fileURLToPath(import.meta.url));

  const runDir = (rawId: string) => store.runDir(runIdOf(rawId));

  async function recordHandcheck(rawRunId: string, body: unknown) {
    const { clipId, junk } = (body ?? {}) as { clipId?: unknown; junk?: unknown };
    if (typeof clipId !== 'string' || !SAFE_ID.test(clipId) || typeof junk !== 'boolean') throw new HttpError(400, 'need {clipId, junk}');
    const dir = runDir(rawRunId);
    await appendFile(join(dir, 'handcheck.jsonl'), JSON.stringify({ clipId, junk, ts: Date.now() }) + '\n');
    // Last verdict per clip wins, so re-marking a clip does not inflate the count.
    const verdicts = new Map<string, boolean>();
    for (const line of (await readFile(join(dir, 'handcheck.jsonl'), 'utf8')).split('\n')) {
      if (line) { const v = JSON.parse(line) as { clipId: string; junk: boolean }; verdicts.set(v.clipId, v.junk); }
    }
    const report = await readJson<Record<string, unknown>>(join(dir, 'report.json'));
    if (verdicts.size >= HANDCHECK_SIZE && report) {
      const junkRateEstimate = [...verdicts.values()].filter(Boolean).length / verdicts.size;
      await writeFile(join(dir, 'report.json'), JSON.stringify({ ...report, junkRateEstimate }, null, 2));
    }
    return { recorded: verdicts.size };
  }

  async function serveFile(res: ServerResponse, rawRunId: string, rawRel: string) {
    let runRoot: string, rel: string[];
    try {
      runRoot = runDir(rawRunId);
      rel = rawRel.split('/').map(decodeURIComponent);
    } catch { throw new HttpError(403, 'forbidden'); }
    if (rel.some((s) => s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0'))) throw new HttpError(403, 'forbidden');
    const full = resolve(runRoot, ...rel);
    if (!full.startsWith(resolve(runRoot) + sep)) throw new HttpError(403, 'forbidden');
    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) throw new HttpError(404, 'not found');
    const ext = full.slice(full.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
    res.end(await readFile(full));
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (data: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      return void res.end(await readFile(join(here, 'index.html')));
    }
    // URL() collapses `..`, which would turn a traversal into a 404: match the raw request path.
    const file = /^\/files\/([^/?]+)\/([^?]+)/.exec(req.url ?? '');
    if (req.method === 'GET' && file) return serveFile(res, file[1], file[2]);

    if (req.method === 'GET' && path === '/api/runs') {
      const ids = await readdir(runsDir).catch(() => [] as string[]);
      const runs = await Promise.all(ids.sort().filter((id) => SAFE_ID.test(id)).map(async (runId) => {
        const report = await readJson<{ site?: string }>(join(store.runDir(runId), 'report.json'));
        const site = report?.site ?? (await store.listClips(runId))[0]?.site ?? '';
        return { runId, site, report };
      }));
      return send(runs);
    }

    const m = /^\/api\/runs\/([^/]+)\/(clips|rejected|sample|handcheck)$/.exec(path);
    if (!m) throw new HttpError(404, 'not found');
    const [, rawRun, what] = m;
    const runId = runIdOf(rawRun);

    if (what === 'handcheck') {
      if (req.method !== 'POST') throw new HttpError(405, 'POST only');
      return send(await recordHandcheck(runId, await readBody(req)));
    }
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');

    if (what === 'clips' || what === 'sample') {
      const kind = url.searchParams.get('kind'), site = url.searchParams.get('site');
      const clips: Clip[] = (await store.listClips(runId)).filter((c) => (!kind || c.kind === kind) && (!site || c.site === site));
      if (what === 'clips') return send(clips);
      const n = Math.max(0, Math.min(Number(url.searchParams.get('n') ?? HANDCHECK_SIZE) || HANDCHECK_SIZE, 500));
      return send(sampleIds(clips.map((c) => c.id), n, url.searchParams.get('seed') ?? DEFAULT_SEED));
    }

    const dir = join(store.runDir(runId), 'rejected');
    const details = new Map<string, string>();
    for (const r of await readTrace(join(store.runDir(runId), 'trace.jsonl')).catch(() => [])) {
      if (r.type === 'clip-rejected') details.set(r.episodeId, r.detail);
    }
    const names = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
    return send(await Promise.all(names.map(async (f) => {
      const rec = await readJson<{ episodeId: string; reason: string }>(join(dir, f));
      const episodeId = rec?.episodeId ?? f.slice(0, -5);
      const hasPng = await stat(join(dir, `${f.slice(0, -5)}.png`)).then(() => true, () => false);
      return { episodeId, reason: rec?.reason ?? 'unknown', detail: details.get(episodeId) ?? '', keyframe: hasPng ? `rejected/${f.slice(0, -5)}.png` : null };
    })));
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(e instanceof HttpError ? e.message : 'internal error');
    });
  });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(opts.port ?? 0, '127.0.0.1', ok); });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('browse server has no port');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((ok, fail) => { server.close((e) => (e ? fail(e) : ok())); server.closeAllConnections(); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 4173;
  startBrowseServer({ port }).then((s) => console.log(`clip browser: ${s.url}`), (e) => { console.error(e); process.exit(1); });
}
