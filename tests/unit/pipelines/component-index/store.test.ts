import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentIndexStore, slugifyOrigin } from '../../../../src/pipelines/component-index/store.js';
import type { ComponentIndex, IndexedComponent } from '../../../../src/pipelines/component-index/types.js';

function mkEntry(sig: string, classification = 'Button'): IndexedComponent {
  return {
    signature: sig,
    classification,
    classificationSource: 'rules',
    firstSeen: '2026-05-14T00:00:00Z',
    lastSeen: '2026-05-14T00:00:00Z',
    occurrences: 1,
    domSample: '<button>x</button>',
    source: 'first-traversal',
  };
}

describe('slugifyOrigin', () => {
  it('replaces :, /, . with -', () => {
    expect(slugifyOrigin('https://app.example.com')).toBe('https---app-example-com');
  });

  it('handles ports', () => {
    expect(slugifyOrigin('https://app.example.com:3000/')).toBe('https---app-example-com-3000-');
  });

  it('handles data: URIs', () => {
    expect(slugifyOrigin('data:text/html,foo')).toBe('data-text-html,foo');
  });
});

describe('ComponentIndexStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses UIPE_COMPONENT_INDEX_DIR env var when set', () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    expect(store.pathFor('https://app.example.com')).toBe(join(tmpDir, 'https---app-example-com.json'));
  });

  it('returns empty index when file is missing', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const index = await store.load('https://app.example.com');
    expect(index).toEqual({ version: 1, origin: 'https://app.example.com', entries: {} });
  });

  it('returns empty index and logs when file is corrupt JSON', async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, 'https---app-example-com.json'), 'not-json{');
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const index = await store.load('https://app.example.com');
    expect(index.entries).toEqual({});
  });

  it('round-trips: save then load', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const initial: ComponentIndex = {
      version: 1,
      origin: 'https://app.example.com',
      entries: { '01234567': mkEntry('01234567') },
    };
    await store.save('https://app.example.com', initial);
    const reloaded = await store.load('https://app.example.com');
    expect(reloaded).toEqual(initial);
  });

  it('serializes concurrent writes per origin (no lost updates)', async () => {
    const store = new ComponentIndexStore({ baseDir: tmpDir });
    const origin = 'https://app.example.com';

    // Two concurrent writers; each reads-then-writes. With the per-origin
    // lock, the second waits for the first.
    async function writer(sig: string) {
      const current = await store.load(origin);
      current.entries[sig] = mkEntry(sig);
      await store.save(origin, current);
    }

    await Promise.all([writer('aaaa1111'), writer('bbbb2222')]);
    const final = await store.load(origin);
    expect(Object.keys(final.entries).sort()).toEqual(['aaaa1111', 'bbbb2222']);
  });

  it('creates the base directory if it does not exist', async () => {
    const nested = join(tmpDir, 'a', 'b', 'c');
    const store = new ComponentIndexStore({ baseDir: nested });
    await store.save('https://x', { version: 1, origin: 'https://x', entries: {} });
    const written = await readFile(join(nested, 'https---x.json'), 'utf8');
    expect(JSON.parse(written).version).toBe(1);
  });

  it('does not crash on disk write failure (returns false)', async () => {
    // Point at a path inside a file (impossible to mkdir over) to force EEXIST.
    const fakeFile = join(tmpDir, 'block');
    await writeFile(fakeFile, 'i am a file');
    const store = new ComponentIndexStore({ baseDir: join(fakeFile, 'sub') });
    const ok = await store.save('https://x', { version: 1, origin: 'https://x', entries: {} });
    expect(ok).toBe(false);
  });
});
