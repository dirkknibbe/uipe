// Screenshot a specific section by scrolling to it.
// Usage: node scripts/capture-section.mjs <selector> <label>
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "screenshots");
const selector = process.argv[2] ?? "#how";
const label = process.argv[3] ?? "section";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const el = await page.locator(selector).first();
await el.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await el.screenshot({ path: resolve(outDir, `${label}.png`) });

await browser.close();
console.log(`wrote screenshot → ${outDir}/${label}.png`);
