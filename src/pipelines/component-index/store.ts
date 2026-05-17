import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createLogger } from '../../utils/logger.js';
import type { ComponentIndex } from './types.js';

const logger = createLogger('ComponentIndexStore');

export function slugifyOrigin(origin: string): string {
  return origin.replace(/[:./]/g, '-');
}

function defaultBaseDir(): string {
  if (process.env.UIPE_COMPONENT_INDEX_DIR) return process.env.UIPE_COMPONENT_INDEX_DIR;
  return join(homedir(), '.uipe', 'component-index');
}

export interface ComponentIndexStoreOptions {
  baseDir?: string;
}

export class ComponentIndexStore {
  private baseDir: string;
  /**
   * Per-origin write lock. `save` chains onto this promise, so concurrent
   * save calls for the same origin are serialized. `save` also performs a
   * read-merge-write internally, so two concurrent read-modify-write callers
   * (load → mutate entries → save) do not lose each other's updates.
   */
  private locks = new Map<string, Promise<void>>();

  constructor(opts: ComponentIndexStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
  }

  pathFor(origin: string): string {
    return join(this.baseDir, `${slugifyOrigin(origin)}.json`);
  }

  async load(origin: string): Promise<ComponentIndex> {
    // Wait for any in-flight write to complete before reading, so a
    // load call sees the result of the most recent save.
    const pending = this.locks.get(origin);
    if (pending) await pending;
    return this.readNow(origin);
  }

  /**
   * Persist the index. The new entries are merged on top of whatever is
   * currently on disk (inside the lock), so two concurrent callers each doing
   * load → mutate → save will not lose each other's updates.
   *
   * Returns true on success, false on failure (caller can decide to drop the
   * entry; future re-traversal will retry). Serializes concurrent writes for
   * the same origin via an in-memory promise chain.
   */
  async save(origin: string, index: ComponentIndex): Promise<boolean> {
    const previous = this.locks.get(origin) ?? Promise.resolve();
    const next = previous.then(() => this.mergeAndWrite(origin, index));
    // Store the chain so subsequent callers queue behind it. We swallow
    // failures in the chained promise to avoid poisoning the lock.
    this.locks.set(origin, next.then(() => undefined, () => undefined));
    return next;
  }

  private async readNow(origin: string): Promise<ComponentIndex> {
    const path = this.pathFor(origin);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as ComponentIndex;
      if (parsed.version !== 1 || typeof parsed.origin !== 'string' || typeof parsed.entries !== 'object') {
        logger.warn('Component index has unexpected shape, treating as empty', { path });
        return { version: 1, origin, entries: {} };
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { version: 1, origin, entries: {} };
      }
      logger.warn('Failed to load component index, treating as empty', { path, error: String(err) });
      return { version: 1, origin, entries: {} };
    }
  }

  /**
   * Read the current on-disk index, merge `incoming` entries on top (incoming
   * wins on collision), and write back. Runs inside the per-origin lock.
   */
  private async mergeAndWrite(origin: string, incoming: ComponentIndex): Promise<boolean> {
    const path = this.pathFor(origin);
    try {
      await mkdir(this.baseDir, { recursive: true });
      // Read whatever is currently on disk so we can merge.
      const current = await this.readNow(origin);
      const merged: ComponentIndex = {
        ...incoming,
        entries: { ...current.entries, ...incoming.entries },
      };
      await writeFile(path, JSON.stringify(merged, null, 2), 'utf8');
      return true;
    } catch (err) {
      logger.warn('Failed to write component index', { path, error: String(err) });
      return false;
    }
  }
}
