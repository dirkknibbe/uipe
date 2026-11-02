import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RejectReason } from '../types.js';
import type { TraceRecord } from '../trace/trace-types.js';
import { readTrace } from '../trace/trace-writer.js';

const MIN_UNIQUE_EPISODES = 15;
const MAX_DUPLICATE_RATE = 0.10;

export interface RunReport {
  runId: string; site: string; stopReason: string;
  kept: number; rejected: number; duplicates: number;
  rejectedByReason: Record<RejectReason, number>;
  uniqueEpisodes: number; states: number; transitions: number; capsHit: string[];
  usd: number; usdPerKeptClip: number | null;
  duplicateRate: number;
  junkRateEstimate: number | null;
  passes: { minUniqueEpisodes: boolean; maxDuplicateRate: boolean };
}

const REASONS: RejectReason[] = [
  'bot-challenge', 'login-wall', 'error-page', 'blank', 'loading', 'cookie-consent',
  'chat-widget', 'ad', 'spinner', 'started-mid-animation', 'not-settled', 'offscreen',
  'covered', 'media-playback', 'no-motion',
];

export function buildReport(trace: TraceRecord[]): RunReport {
  const rejectedByReason = Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<RejectReason, number>;
  const keptEpisodes = new Set<string>();
  const stateSigs = new Set<string>();
  const capsHit: string[] = [];
  let kept = 0, duplicates = 0, rejected = 0, transitions = 0, usd = 0, ended = false;
  let endReason: string | undefined;
  for (const r of trace) {
    switch (r.type) {
      case 'clip-kept': kept++; keptEpisodes.add(r.episodeId); break;
      case 'clip-duplicate': duplicates++; break;
      case 'clip-rejected': rejected++; rejectedByReason[r.reason]++; break;
      case 'cap-hit': capsHit.push(r.cap); break;
      case 'trigger': transitions++; break;
      case 'explorer-step': usd += r.usd; stateSigs.add(r.observationSummary); break;
      case 'run-end': ended = true; endReason = r.stopReason; break;
      default: break;
    }
  }
  const duplicateRate = kept + duplicates === 0 ? 0 : duplicates / (kept + duplicates);
  return {
    runId: trace[0]?.runId ?? '', site: trace[0]?.site ?? '',
    stopReason: !ended ? 'interrupted' : endReason ?? capsHit.at(-1) ?? 'completed',
    kept, rejected, duplicates, rejectedByReason,
    uniqueEpisodes: keptEpisodes.size,
    // ponytail: no state records in the trace; distinct explorer observations stand in for states
    states: stateSigs.size, transitions, capsHit,
    usd, usdPerKeptClip: kept ? usd / kept : null,
    duplicateRate, junkRateEstimate: null,
    passes: {
      minUniqueEpisodes: keptEpisodes.size >= MIN_UNIQUE_EPISODES,
      maxDuplicateRate: duplicateRate <= MAX_DUPLICATE_RATE,
    },
  };
}

export function renderReportMarkdown(r: RunReport): string {
  const pass = r.passes.minUniqueEpisodes && r.passes.maxDuplicateRate;
  const reasons = Object.entries(r.rejectedByReason).filter(([, n]) => n > 0).map(([k, n]) => `- ${k}: ${n}`);
  return [
    `kept ${r.kept} · rejected ${r.rejected} · duplicate rate ${(r.duplicateRate * 100).toFixed(1)}% · unique ${r.uniqueEpisodes} · ${pass ? 'PASS' : 'FAIL'} (dup ≤10%, unique ≥15) · junk: pending hand-check (40)`,
    '',
    `Run ${r.runId} on ${r.site}, stop reason: ${r.stopReason}`,
    `States ${r.states}, transitions ${r.transitions}, duplicates ${r.duplicates}`,
    `Caps hit: ${r.capsHit.length ? r.capsHit.join(', ') : 'none'}`,
    `Spend $${r.usd.toFixed(2)}${r.usdPerKeptClip === null ? '' : ` ($${r.usdPerKeptClip.toFixed(2)} per kept clip)`}`,
    '',
    '## Rejected by reason',
    ...(reasons.length ? reasons : ['- none']),
    '',
  ].join('\n');
}

export async function regenerateReport(runDir: string): Promise<RunReport> {
  const report = buildReport(await readTrace(join(runDir, 'trace.jsonl')));
  await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(runDir, 'report.md'), renderReportMarkdown(report));
  return report;
}
