import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name: string) => path.join(FIXTURES, name);

/** Waits until the app has finished all scheduled rendering. */
export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__backdrop, null, { timeout: 30_000 });
  await page.evaluate(() => window.__backdrop!.idle());
  await expect(page.getByTestId('preview')).toHaveAttribute('data-status', 'ready');
}

export async function openApp(page: Page, query = 'seed=777'): Promise<void> {
  await page.goto(`/?${query}`);
  await waitForIdle(page);
}

export type RegionStats = {
  mean: [number, number, number];
  lumaP10: number;
  lumaP50: number;
  lumaP99: number;
  /** 99th percentile of max(r, g, b) — brightness independent of hue. */
  valueP99: number;
  /** Fraction of pixels whose brightest channel exceeds 140. */
  brightFraction: number;
};

/**
 * Pixel statistics for a region of the preview canvas, given in fractions of
 * the canvas size ([x0, y0, x1, y1]).
 */
export async function regionStats(page: Page, region: [number, number, number, number]): Promise<RegionStats> {
  return page.evaluate((r) => {
    const c = document.querySelector('[data-testid="preview"]') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const x = Math.round(r[0] * c.width);
    const y = Math.round(r[1] * c.height);
    const w = Math.max(1, Math.round((r[2] - r[0]) * c.width));
    const h = Math.max(1, Math.round((r[3] - r[1]) * c.height));
    const d = g.getImageData(x, y, w, h).data;
    let R = 0;
    let G = 0;
    let B = 0;
    let bright = 0;
    const L: number[] = [];
    const V: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      R += d[i];
      G += d[i + 1];
      B += d[i + 2];
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 140) bright++;
      L.push(l);
      V.push(Math.max(d[i], d[i + 1], d[i + 2]));
    }
    const n = d.length / 4;
    L.sort((a, b) => a - b);
    V.sort((a, b) => a - b);
    return {
      mean: [R / n, G / n, B / n] as [number, number, number],
      lumaP10: L[Math.floor(n * 0.1)],
      lumaP50: L[Math.floor(n * 0.5)],
      lumaP99: L[Math.floor(n * 0.99)],
      valueP99: V[Math.floor(n * 0.99)],
      brightFraction: bright / n,
    };
  }, region);
}

/** A cheap fingerprint of the canvas pixels for equality checks. */
export async function canvasHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const c = document.querySelector('[data-testid="preview"]') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const buf = await crypto.subtle.digest('SHA-256', d);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  });
}

export async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="preview"]') as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });
}

/** Reads width/height from a PNG file's IHDR chunk. */
export function pngSize(buf: Buffer): { width: number; height: number } {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Percentage of channel-wise difference between two RGB means. */
export function hueDominance(mean: [number, number, number]): 'red' | 'green' | 'blue' {
  const [r, g, b] = mean;
  if (r >= g && r >= b) return 'red';
  if (g >= r && g >= b) return 'green';
  return 'blue';
}
