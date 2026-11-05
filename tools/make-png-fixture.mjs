// Generates e2e/fixtures/logo-badge.png (a transparent PNG logo) for tests.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const b = await chromium.launch();
const p = await b.newPage();
const url = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 480; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#ff9f1c'; g.beginPath(); g.arc(80, 80, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b0f14'; g.beginPath(); g.arc(80, 80, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.font = 'bold 64px Arial'; g.textBaseline = 'middle'; g.fillText('ORBIT', 165, 84);
  return c.toDataURL('image/png');
});
fs.writeFileSync('e2e/fixtures/logo-badge.png', Buffer.from(url.split(',')[1], 'base64'));
await b.close();
console.log('ok');
