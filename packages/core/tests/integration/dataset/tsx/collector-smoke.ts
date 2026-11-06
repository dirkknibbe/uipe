// Run under tsx (not vitest): esbuild keepNames turns named functions in page.evaluate bodies into
// __name(...) calls, which only exist in the page if the runtime installed the shim.
import { BrowserRuntime } from '../../../../src/browser/runtime.js';
import { TemporalEventStream } from '../../../../src/pipelines/temporal/event-stream.js';
import { InputCollector, MutationCollector } from '../../../../src/pipelines/temporal/collectors/index.js';

const runtime = new BrowserRuntime();
await runtime.launch();
const page = runtime.getPage();
const warnings: string[] = [];
const warn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
try {
  await page.setContent('<div id="root"></div>');
  const stream = new TemporalEventStream();
  await stream.attach(page, [new InputCollector(), new MutationCollector()]);
  await page.evaluate("document.getElementById('root').appendChild(document.createElement('p'))");
  await page.mouse.click(10, 10);
  let types: string[] = [];
  for (let i = 0; i < 20 && !(types.includes('mutation') && types.includes('input')); i++) {
    await page.waitForTimeout(100);
    types = stream.getEvents().map((e) => e.type);
  }
  console.log(JSON.stringify({ mutation: types.includes('mutation'), input: types.includes('input'), warnings }));
} finally {
  console.warn = warn;
  await runtime.close();
}
