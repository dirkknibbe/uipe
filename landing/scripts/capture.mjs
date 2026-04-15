// Screenshot the landing page at 1440x900 for visual verification.
// Usage: node scripts/capture.mjs [label]
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "screenshots");
const label = process.argv[2] ?? "current";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });
// Let the 3D scene settle.
await page.waitForTimeout(1800);

await page.screenshot({
  path: resolve(outDir, `${label}-hero.png`),
  fullPage: false,
});

await page.evaluate(() =>
  window.scrollTo({ top: window.innerHeight, behavior: "instant" }),
);
await page.waitForTimeout(600);
await page.screenshot({
  path: resolve(outDir, `${label}-problem.png`),
  fullPage: false,
});

await page.screenshot({
  path: resolve(outDir, `${label}-full.png`),
  fullPage: true,
});

await browser.close();
console.log(`wrote screenshots → ${outDir}/${label}-{hero,problem,full}.png`);
