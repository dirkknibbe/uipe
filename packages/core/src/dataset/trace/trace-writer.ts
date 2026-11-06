import { appendFile, readFile } from 'node:fs/promises';
import type { TraceRecord } from './trace-types.js';

/** Distributive omit: a plain Omit over a union would collapse the discriminant. */
export type TraceInput = TraceRecord extends infer R
  ? R extends TraceRecord ? Omit<R, 'id' | 'runId' | 'site' | 'ts'> : never
  : never;

export class TraceWriter {
  private seq = 0;
  private chain: Promise<void> = Promise.resolve();
  private error: unknown;

  constructor(private readonly path: string, private readonly runId: string, private readonly site: string) {}

  write(r: TraceInput): string {
    const id = `${this.runId}-${String(++this.seq).padStart(6, '0')}`;
    const line = JSON.stringify({ ...r, id, runId: this.runId, site: this.site, ts: Date.now() }) + '\n';
    this.chain = this.chain
      .then(() => appendFile(this.path, line))
      .catch((e) => { this.error ??= e; });
    return id;
  }

  async flush(): Promise<void> {
    await this.chain;
    if (this.error) throw this.error;
  }

  close(): Promise<void> {
    return this.flush();
  }
}

export async function readTrace(path: string): Promise<TraceRecord[]> {
  const out: TraceRecord[] = [];
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* truncated final line from a crash */ }
  }
  return out;
}
