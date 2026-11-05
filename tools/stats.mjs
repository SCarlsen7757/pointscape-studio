// Usage: node tools/stats.mjs img1 [img2 ...] — prints mean sRGB colour + luminance percentiles for regions (fractions of the image).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const regions = {
  topCenter: [0.35, 0.0, 0.65, 0.15], centerLogo: [0.3, 0.3, 0.7, 0.55], topLeft: [0, 0, 0.2, 0.3], topRight: [0.8, 0, 1, 0.3],
  band: [0.3, 0.62, 0.7, 0.8], bottom: [0, 0.85, 1, 1], leftMid: [0, 0.6, 0.2, 0.8], rightMid: [0.8, 0.6, 1, 0.8],
};
const b = await chromium.launch();
const p = await b.newPage();
for (const f of process.argv.slice(2)) {
  const data = 'data:image/' + (f.endsWith('webp') ? 'webp' : 'png') + ';base64,' + fs.readFileSync(f).toString('base64');
  const res = await p.evaluate(async ([data, regions]) => {
    const img = new Image(); img.src = data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const out = {};
    for (const [k, [x0, y0, x1, y1]] of Object.entries(regions)) {
      const X = Math.round(x0 * c.width), Y = Math.round(y0 * c.height), W = Math.round((x1 - x0) * c.width), H = Math.round((y1 - y0) * c.height);
      const d = g.getImageData(X, Y, W, H).data; let r = 0, gg = 0, bb = 0; const L = [];
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; L.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); }
      const n = d.length / 4; L.sort((a, b) => a - b);
      out[k] = `rgb(${(r / n).toFixed(0)},${(gg / n).toFixed(0)},${(bb / n).toFixed(0)}) p10=${L[Math.floor(n * 0.1)].toFixed(0)} p50=${L[Math.floor(n * 0.5)].toFixed(0)} p99=${L[Math.floor(n * 0.99)].toFixed(0)} p999=${L[Math.floor(n * 0.999)].toFixed(0)}`;
    }
    return out;
  }, [data, regions]);
  console.log('==', f.split(/[\/]/).pop());
  for (const [k, v] of Object.entries(res)) console.log('  ', k.padEnd(11), v);
}
await b.close();
