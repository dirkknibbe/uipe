import { parseArgs } from 'node:util';
import { runSite } from '../run/run-site.js';
import { renderReportMarkdown } from '../run/report.js';

const SIGINT_EXIT = 130;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { site: { type: 'string', multiple: true }, contact: { type: 'string' }, 'max-usd': { type: 'string' } },
  });
  const sites = values.site ?? [];
  if (sites.length === 0 || !values.contact) {
    console.error('usage: dataset:run --site <url> [--site <url>...] --contact <url> [--max-usd N]');
    return 2;
  }
  const maxUsd = values['max-usd'] === undefined ? undefined : Number(values['max-usd']);
  if (maxUsd !== undefined && !(maxUsd > 0)) {
    console.error('--max-usd must be a positive number');
    return 2;
  }

  const abort = new AbortController();
  process.once('SIGINT', () => {
    console.error('\nSIGINT: stopping after the current step, flushing, writing a partial report...');
    abort.abort();
    process.once('SIGINT', () => process.exit(SIGINT_EXIT)); // second Ctrl-C forces it
  });

  let failed = false;
  for (const site of sites) {
    if (abort.signal.aborted) break;
    try {
      const { runId, report } = await runSite({
        startUrl: site, contactUrl: values.contact, signal: abort.signal, ...(maxUsd === undefined ? {} : { caps: { maxUsd } }),
      });
      console.log(`${site} [${runId}] ${renderReportMarkdown(report).split('\n')[0]}`);
    } catch (e) {
      failed = true;
      console.error(`${site}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return abort.signal.aborted ? SIGINT_EXIT : failed ? 1 : 0;
}

process.exit(await main());
