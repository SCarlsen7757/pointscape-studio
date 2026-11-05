// Usage: node tools/crop.mjs in.png out.png x y w h [scale]   (uses headless Chromium canvas)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [inp, out, x, y, w, h, scale = '1'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
const data = 'data:image/' + (inp.endsWith('webp') ? 'webp' : 'png') + ';base64,' + fs.readFileSync(inp).toString('base64');
const url = await p.evaluate(async ([data, x, y, w, h, s]) => {
  const img = new Image(); img.src = data; await img.decode();
  const c = document.createElement('canvas'); c.width = w * s; c.height = h * s;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h, 0, 0, w * s, h * s);
  return c.toDataURL('image/png');
}, [data, +x, +y, +w, +h, +scale]);
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close();
