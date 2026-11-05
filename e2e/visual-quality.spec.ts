import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, openApp, regionStats, waitForIdle } from './helpers';

/**
 * Visual "spec" guards. These encode the composition rules of the reference
 * look, so regressions in the renderer are caught automatically:
 *  - the logo area stays dark and uncluttered,
 *  - the wave band has crisp, bright highlights,
 *  - the foreground keeps deep blacks between bokeh,
 *  - floating dust frames the upper corners,
 *  - nothing is blown out.
 * Each render is also written to test-results/gallery for human review.
 */
const CASES = [
  { seed: 777, palette: 'teal-frost' },
  { seed: 12345, palette: 'teal-frost' },
  { seed: 4242, palette: 'arctic' },
  { seed: 9001, palette: 'amber' },
  { seed: 31337, palette: 'violet' },
  { seed: 2024, palette: 'emerald' },
  { seed: 55555, palette: 'crimson' },
  { seed: 8080, palette: 'silver' },
  { seed: 6060, palette: 'neon-tropic' },
];

const GALLERY = path.join('test-results', 'gallery');

test.describe('visual quality', () => {
  test.beforeAll(() => fs.mkdirSync(GALLERY, { recursive: true }));

  for (const c of CASES) {
    test(`seed ${c.seed} · ${c.palette} meets the composition spec`, async ({ page }) => {
      await openApp(page, `seed=${c.seed}&palette=${c.palette}`);

      const logoZone = await regionStats(page, [0.3, 0.28, 0.7, 0.52]);
      expect(logoZone.lumaP50, 'logo area should be dark').toBeLessThan(42);
      expect(logoZone.brightFraction, 'logo area should be uncluttered').toBeLessThan(0.003);

      const band = await regionStats(page, [0.05, 0.56, 0.95, 0.86]);
      expect(band.valueP99, 'wave band needs bright highlights').toBeGreaterThan(150);
      expect(band.brightFraction, 'wave band needs visible structure').toBeGreaterThan(0.004);

      const bottom = await regionStats(page, [0, 0.9, 1, 1]);
      expect(bottom.lumaP10, 'foreground keeps deep blacks').toBeLessThan(32);

      const tl = await regionStats(page, [0, 0, 0.22, 0.35]);
      const tr = await regionStats(page, [0.78, 0, 1, 0.35]);
      expect(Math.max(tl.valueP99, tr.valueP99), 'dust frames the upper corners').toBeGreaterThan(55);

      const whole = await regionStats(page, [0, 0, 1, 1]);
      expect(whole.lumaP50, 'image should be predominantly dark').toBeLessThan(50);
      const blown = await page.evaluate(() => {
        const cv = document.querySelector('[data-testid="preview"]') as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) n++;
        return n / (d.length / 4);
      });
      expect(blown, 'no large blown-out areas').toBeLessThan(0.01);

      // Composite with logos for the review gallery.
      await page.getByTestId('logo-input').setInputFiles([fixture('logo-mark.svg'), fixture('logo-wordmark.svg')]);
      await expect(page.getByTestId('logo-item')).toHaveCount(2);
      await waitForIdle(page);
      const png = await page.evaluate(() =>
        (document.querySelector('[data-testid="preview"]') as HTMLCanvasElement).toDataURL('image/png'),
      );
      fs.writeFileSync(path.join(GALLERY, `${c.seed}-${c.palette}.png`), Buffer.from(png.split(',')[1], 'base64'));
    });
  }
});
