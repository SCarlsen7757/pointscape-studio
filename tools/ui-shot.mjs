// Screenshot of the full UI with test logos loaded. Usage: node tools/ui-shot.mjs out.png [query]
import { chromium } from '@playwright/test';
const [out, q = 'seed=777'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`http://localhost:5173/?${q}`);
await p.waitForFunction(() => !!window.__backdrop);
await p.getByTestId('logo-input').setInputFiles(['e2e/fixtures/logo-mark.svg', 'e2e/fixtures/logo-wordmark.svg']);
await p.getByTestId('logo-item').nth(1).waitFor();
await p.evaluate(() => window.__backdrop.idle());
await p.screenshot({ path: out });
await b.close();
