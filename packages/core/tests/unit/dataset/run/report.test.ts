import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport, renderReportMarkdown, regenerateReport } from '../../../../src/dataset/run/report.js';
import type { TraceRecord } from '../../../../src/dataset/trace/trace-types.js';

let n = 0;
const base = () => ({ id: `r-${++n}`, runId: 'r', site: 's.com', step: n, ts: n });
const kept = (i: number): TraceRecord => ({ ...base(), type: 'clip-kept', episodeId: `k${i}`, clipId: `c${i}` });
const dup = (i: number): TraceRecord => ({ ...base(), type: 'clip-duplicate', episodeId: `d${i}`, duplicateOf: 'c0' });
const end = (): TraceRecord => ({ ...base(), type: 'run-end' });
const make = (k: number, d: number): TraceRecord[] => [
  { ...base(), type: 'run-start' },
  ...Array.from({ length: k }, (_, i) => kept(i)),
  ...Array.from({ length: d }, (_, i) => dup(i)),
  end(),
];

describe('buildReport', () => {
  it('counts_kept_rejected_duplicates_by_reason', () => {
    const r = buildReport([
      ...make(2, 1),
      { ...base(), type: 'clip-rejected', episodeId: 'x', reason: 'blank', detail: '' },
      { ...base(), type: 'clip-rejected', episodeId: 'y', reason: 'blank', detail: '' },
      { ...base(), type: 'clip-rejected', episodeId: 'z', reason: 'ad', detail: '' },
      { ...base(), type: 'cap-hit', cap: 'maxUsd' },
      { ...base(), type: 'explorer-step', observationSummary: 'a', decision: '', rationale: '', inputTokens: 1, outputTokens: 1, usd: 0.25 },
      { ...base(), type: 'explorer-step', observationSummary: 'b', decision: '', rationale: '', inputTokens: 1, outputTokens: 1, usd: 0.25 },
    ]);
    expect(r).toMatchObject({ kept: 2, rejected: 3, duplicates: 1, uniqueEpisodes: 2, states: 2, capsHit: ['maxUsd'], usd: 0.5, usdPerKeptClip: 0.25, stopReason: 'maxUsd' });
    expect(r.rejectedByReason.blank).toBe(2);
    expect(r.rejectedByReason.ad).toBe(1);
    expect(r.rejectedByReason.spinner).toBe(0);
    expect(r.junkRateEstimate).toBeNull();
  });

  it('duplicate_rate_and_pass_flags_at_thresholds', () => {
    expect(buildReport(make(18, 2)).passes).toEqual({ minUniqueEpisodes: true, maxDuplicateRate: true }); // 10%
    expect(buildReport(make(89, 11)).passes.maxDuplicateRate).toBe(false); // 11%
    expect(buildReport(make(15, 0)).passes.minUniqueEpisodes).toBe(true);
    expect(buildReport(make(14, 0)).passes.minUniqueEpisodes).toBe(false);
  });

  it('markdown_first_line_leads_with_quality', () => {
    const md = renderReportMarkdown(buildReport(make(18, 2)));
    expect(md.split('\n')[0]).toBe('kept 18 · rejected 0 · duplicate rate 10.0% · unique 18 · PASS (dup ≤10%, unique ≥15) · junk: pending hand-check (40)');
  });

  it('report_regenerates_from_partial_trace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-'));
    const lines = make(1, 0).slice(0, -1).map((r) => JSON.stringify(r)).join('\n');
    await writeFile(join(dir, 'trace.jsonl'), lines + '\n{"type":"clip-ke');
    const r = await regenerateReport(dir);
    expect(r.stopReason).toBe('interrupted');
    expect(r.kept).toBe(1);
    expect(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).stopReason).toBe('interrupted');
    expect((await readFile(join(dir, 'report.md'), 'utf8')).startsWith('kept 1')).toBe(true);
  });
});
