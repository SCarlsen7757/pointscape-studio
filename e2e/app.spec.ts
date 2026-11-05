import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  canvasHash,
  canvasSize,
  fixture,
  hueDominance,
  openApp,
  pngSize,
  regionStats,
  waitForIdle,
} from './helpers';

const LOGO_ZONE: [number, number, number, number] = [0.3, 0.3, 0.7, 0.52];
const LEFT_TERRAIN: [number, number, number, number] = [0, 0.55, 0.25, 0.9];

test.describe('app', () => {
  test('renders a point-cloud landscape on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);

    await expect(page.getByTestId('status')).toHaveText('Ready');
    // Native 4K is the default output.
    await expect(page.getByTestId('render-info')).toContainText('3840×2160 (native)');
    expect(await canvasSize(page)).toEqual({ width: 3840, height: 2160 });
    await expect(page.getByTestId('size')).toHaveValue('3840x2160');

    const band = await regionStats(page, [0.05, 0.55, 0.95, 0.85]);
    expect(band.lumaP99).toBeGreaterThan(120);
    const centre = await regionStats(page, LOGO_ZONE);
    expect(centre.lumaP50).toBeLessThan(45);
    expect(errors).toEqual([]);
  });

  test('uploads multiple logos and centres them with dividers', async ({ page }) => {
    await openApp(page);
    const before = await regionStats(page, LOGO_ZONE);

    await page.getByTestId('logo-input').setInputFiles([
      fixture('logo-mark.svg'),
      fixture('logo-wordmark.svg'),
      fixture('logo-badge.png'),
    ]);
    await expect(page.getByTestId('logo-item')).toHaveCount(3);
    await waitForIdle(page);

    const after = await regionStats(page, LOGO_ZONE);
    expect(after.brightFraction).toBeGreaterThan(before.brightFraction + 0.01);

    const layout = await page.evaluate(() => window.__app!.layout());
    expect(layout!.logos).toHaveLength(3);
    expect(layout!.dividers).toHaveLength(2);
    const b = layout!.bounds!;
    expect(Math.abs(b.x + b.width / 2 - 3840 / 2)).toBeLessThan(1);
    // Logos sit in the clear area above the waves.
    expect(b.y + b.height).toBeLessThan(2160 * 0.55);
  });

  test('reorders, rescales and removes logos', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('logo-input').setInputFiles([fixture('logo-mark.svg'), fixture('logo-wordmark.svg')]);
    const items = page.getByTestId('logo-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('logo-mark.svg');

    await items.nth(0).getByRole('button', { name: 'Move right' }).click();
    await expect(items.nth(0)).toContainText('logo-wordmark.svg');
    await expect(items.nth(1)).toContainText('logo-mark.svg');

    await waitForIdle(page);
    const w1 = (await page.evaluate(() => window.__app!.layout()))!.logos[1].width;
    await items.nth(1).getByTestId('logo-scale').fill('1.6');
    await waitForIdle(page);
    const w2 = (await page.evaluate(() => window.__app!.layout()))!.logos[1].width;
    expect(w2).toBeGreaterThan(w1 * 1.3);

    await items.nth(0).getByTestId('logo-remove').click();
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText('logo-mark.svg');
  });

  test('rejects files that are not images', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('logo-input').setInputFiles([fixture('not-an-image.txt'), fixture('logo-mark.svg')]);
    await expect(page.getByTestId('logo-error')).toContainText('not-an-image.txt');
    await expect(page.getByTestId('logo-item')).toHaveCount(1);
  });

  test('logo layout controls update the composition', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('logo-input').setInputFiles([fixture('logo-mark.svg'), fixture('logo-badge.png')]);
    await expect(page.getByTestId('logo-item')).toHaveCount(2);
    await waitForIdle(page);
    const base = (await page.evaluate(() => window.__app!.layout()))!;

    await page.getByTestId('slider-logoSize').fill('0.2');
    await waitForIdle(page);
    const bigger = (await page.evaluate(() => window.__app!.layout()))!;
    expect(bigger.bounds!.width).toBeGreaterThan(base.bounds!.width * 1.4);

    await page.getByTestId('dividers').uncheck();
    await waitForIdle(page);
    expect((await page.evaluate(() => window.__app!.layout()))!.dividers).toHaveLength(0);

    await page.getByTestId('slider-logoY').fill('0.3');
    await waitForIdle(page);
    const moved = (await page.evaluate(() => window.__app!.layout()))!;
    expect(moved.bounds!.y + moved.bounds!.height / 2).toBeCloseTo(2160 * 0.3, 0);
  });

  test('colour schemes change the particle colours', async ({ page }) => {
    await openApp(page);
    expect(hueDominance((await regionStats(page, LEFT_TERRAIN)).mean)).not.toBe('red');

    await page.getByTestId('palette-amber').click();
    await waitForIdle(page);
    await expect(page.getByTestId('palette-amber')).toHaveAttribute('aria-pressed', 'true');
    expect(hueDominance((await regionStats(page, LEFT_TERRAIN)).mean)).toBe('red');

    await page.getByText('Custom colours').click();
    await page.getByTestId('color-left').fill('#00ff40');
    await waitForIdle(page);
    expect(hueDominance((await regionStats(page, LEFT_TERRAIN)).mean)).toBe('green');
    await expect(page.locator('[data-palette][aria-pressed="true"]')).toHaveCount(0);
  });

  test('same seed is deterministic, new variation changes the image', async ({ page }) => {
    await openApp(page, 'seed=4242');
    const h1 = await canvasHash(page);
    await page.reload();
    await waitForIdle(page);
    expect(await canvasHash(page)).toBe(h1);

    await page.getByTestId('randomize').click();
    await waitForIdle(page);
    const seed = await page.getByTestId('preview').getAttribute('data-seed');
    expect(seed).not.toBe('4242');
    expect(await canvasHash(page)).not.toBe(h1);
    await expect(page).toHaveURL(new RegExp(`seed=${seed}`));

    await page.getByTestId('seed').fill('4242');
    await page.getByTestId('seed').press('Enter');
    await waitForIdle(page);
    expect(await canvasHash(page)).toBe(h1);
  });

  test('generation sliders re-render the cloud', async ({ page }) => {
    await openApp(page);
    const h1 = await canvasHash(page);
    const n1 = await page.evaluate(() => window.__app!.stats()!.points);
    await page.getByTestId('slider-density').fill('1.5');
    await waitForIdle(page);
    const n2 = await page.evaluate(() => window.__app!.stats()!.points);
    expect(n2).toBeGreaterThan(n1 * 1.3);
    expect(await canvasHash(page)).not.toBe(h1);
  });

  test('exports PNG and JPEG at the selected size', async ({ page }) => {
    await openApp(page, 'seed=31337');
    await page.getByTestId('logo-input').setInputFiles([fixture('logo-mark.svg'), fixture('logo-wordmark.svg')]);
    await expect(page.getByTestId('logo-item')).toHaveCount(2);
    await waitForIdle(page);

    let [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toBe('pointscape-teal-frost-31337-3840x2160.png');
    let buf = fs.readFileSync((await download.path())!);
    expect(pngSize(buf)).toEqual({ width: 3840, height: 2160 });

    await page.getByTestId('size').selectOption('1280x720');
    await waitForIdle(page);
    expect(await canvasSize(page)).toEqual({ width: 1280, height: 720 });
    [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    buf = fs.readFileSync((await download.path())!);
    expect(pngSize(buf)).toEqual({ width: 1280, height: 720 });

    await page.getByTestId('format').selectOption('jpeg');
    [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toMatch(/\.jpg$/);
    buf = fs.readFileSync((await download.path())!);
    expect(buf.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  });

  test('smaller outputs are supersampled from a native 4K render', async ({ page }) => {
    await openApp(page, 'seed=777&size=1920x1080');
    expect(await canvasSize(page)).toEqual({ width: 1920, height: 1080 });
    const stats = await page.evaluate(() => window.__app!.stats()!);
    expect(stats.renderWidth).toBe(3840);
    expect(stats.renderHeight).toBe(2160);
    await expect(page.getByTestId('render-info')).toContainText('rendered at 3840×2160');

    await page.getByTestId('size').selectOption('1080x1080');
    await waitForIdle(page);
    const sq = await page.evaluate(() => window.__app!.stats()!);
    expect([sq.renderWidth, sq.renderHeight]).toEqual([2160, 2160]);
  });

  test('reset settings restores defaults but keeps the variation and logos', async ({ page }) => {
    await openApp(page, 'seed=4242');
    const original = await canvasHash(page);
    await page.getByTestId('logo-input').setInputFiles([fixture('logo-mark.svg'), fixture('logo-wordmark.svg')]);
    await expect(page.getByTestId('logo-item')).toHaveCount(2);
    await waitForIdle(page);
    const withLogos = await canvasHash(page);

    await page.getByTestId('palette-neon-tropic').click();
    await page.getByTestId('slider-density').fill('1.5');
    await page.getByTestId('slider-logoSize').fill('0.2');
    await page.getByTestId('logo-item').nth(0).getByTestId('logo-scale').fill('1.8');
    await page.getByTestId('dividers').uncheck();
    await page.getByTestId('size').selectOption('1280x720');
    await page.getByTestId('format').selectOption('jpeg');
    await waitForIdle(page);
    expect(await canvasHash(page)).not.toBe(withLogos);

    await page.getByTestId('reset').click();
    await waitForIdle(page);
    await expect(page.getByTestId('palette-teal-frost')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('slider-density')).toHaveValue('1');
    await expect(page.getByTestId('slider-logoSize')).toHaveValue('0.115');
    await expect(page.getByTestId('logo-item').nth(0).getByTestId('logo-scale')).toHaveValue('1');
    await expect(page.getByTestId('dividers')).toBeChecked();
    await expect(page.getByTestId('size')).toHaveValue('3840x2160');
    await expect(page.getByTestId('format')).toHaveValue('png');
    await expect(page.getByTestId('seed')).toHaveValue('4242');
    await expect(page.getByTestId('logo-item')).toHaveCount(2);
    // Same seed + logos + default settings ⇒ the exact same image as before the changes.
    expect(await canvasHash(page)).toBe(withLogos);
    expect(withLogos).not.toBe(original);
  });

  test('offers the Neon Tropic colour scheme', async ({ page }) => {
    await openApp(page, 'seed=777&palette=neon-tropic');
    await expect(page.getByTestId('palette-neon-tropic')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('palette-neon-tropic')).toContainText('Neon Tropic');
    // Hot pink on the left: red and blue dominate green.
    const left = (await regionStats(page, LEFT_TERRAIN)).mean;
    expect(left[0]).toBeGreaterThan(left[1] * 1.3);
    expect(left[2]).toBeGreaterThan(left[1]);
  });

  test('reads seed and palette from the URL', async ({ page }) => {
    await openApp(page, 'seed=9001&palette=violet');
    await expect(page.getByTestId('seed')).toHaveValue('9001');
    await expect(page.getByTestId('palette-violet')).toHaveAttribute('aria-pressed', 'true');
  });
});
