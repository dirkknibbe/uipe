import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceWriter, readTrace } from '../../../../src/dataset/trace/trace-writer.js';

async function tmpPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'trace-')), 'trace.jsonl');
}

describe('TraceWriter', () => {
  it('writes_one_json_line_per_record_with_ids', async () => {
    const p = await tmpPath();
    const w = new TraceWriter(p, 'run1', 'example.com');
    const id = w.write({ type: 'run-start', step: 0 });
    w.write({ type: 'clip-rejected', step: 1, episodeId: 'e1', reason: 'blank', detail: 'x' });
    await w.close();
    const lines = (await readFile(p, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ id, runId: 'run1', site: 'example.com', type: 'run-start', step: 0 });
    expect(typeof first.ts).toBe('number');
  });

  it('read_trace_skips_truncated_final_line', async () => {
    const p = await tmpPath();
    const w = new TraceWriter(p, 'run1', 's');
    w.write({ type: 'run-start', step: 0 });
    w.write({ type: 'run-end', step: 1 });
    await w.close();
    await appendFile(p, '{"type":"tri');
    const recs = await readTrace(p);
    expect(recs.map((r) => r.type)).toEqual(['run-start', 'run-end']);
  });

  it('ids_are_unique_and_monotonic_within_run', async () => {
    const p = await tmpPath();
    const w = new TraceWriter(p, 'run1', 's');
    const ids = Array.from({ length: 12 }, (_, i) => w.write({ type: 'cap-hit', step: i, cap: 'steps' }));
    await w.close();
    expect(new Set(ids).size).toBe(12);
    expect([...ids].sort()).toEqual(ids);
  });
});
