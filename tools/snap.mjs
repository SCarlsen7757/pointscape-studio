// Usage: node tools/snap.mjs <outDir> [query ...]   (needs `npm run dev` running on :5173)
import { chromium } from '@playwright/test';
const [outDir, ...queries] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => console.log('console:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
for (const q of queries.length ? queries : ['seed=12345']) {
  await page.goto(`http://localhost:5173/?${q}`);
  await page.waitForFunction(() => !!window.__backdrop, null, { timeout: 120000 });
  await page.evaluate(() => window.__backdrop.idle());
  const data = await page.evaluate(() => document.querySelector('[data-testid="preview"]').toDataURL('image/png'));
  const fs = await import('node:fs');
  const name = q.replace(/[^a-z0-9]+/gi, '_');
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await browser.close();
