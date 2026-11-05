import { describe, expect, it } from 'vitest';
import { gradientEnds, linearToOklch, mixOklch, oklchToLinear, srgbToLinear, type Rgb } from '../../src/core/color';
import { hexToRgb } from '../../src/core/palettes';

const lin = (hex: string): Rgb => hexToRgb(hex).map((v) => srgbToLinear(v / 255)) as Rgb;

describe('OKLCH colour blending', () => {
  it('round-trips linear sRGB', () => {
    for (const hex of ['#ff2e9a', '#00f0d0', '#16d5e6', '#808080', '#000000', '#ffffff']) {
      const c = lin(hex);
      const back = oklchToLinear(linearToOklch(c));
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 4));
    }
  });

  it('keeps a pink → turquoise gradient saturated through the middle', () => {
    const [a, b] = gradientEnds(lin('#ff2e9a'), lin('#00f0d0'));
    const mid = mixOklch(a, b, 0.5);
    expect(mid[1]).toBeGreaterThan(Math.min(a[1], b[1]) * 0.9);
    // A plain RGB blend would be close to grey.
    const rgbMid = lin('#ff2e9a').map((v, i) => (v + lin('#00f0d0')[i]) / 2) as Rgb;
    expect(linearToOklch(rgbMid)[1]).toBeLessThan(mid[1] * 0.6);
  });

  it('uses the coloured end hue when the other end is neutral (no hue swing)', () => {
    const [a, b] = gradientEnds(lin('#ff3048'), lin('#e3e8f2'));
    expect(b[2]).toBeCloseTo(a[2]);
  });

  it('takes the shorter hue arc', () => {
    const a: [number, number, number] = [0.7, 0.15, 3.0];
    const b: [number, number, number] = [0.7, 0.15, -3.0];
    const mid = mixOklch(a, b, 0.5);
    expect(Math.abs(Math.cos(mid[2]) - Math.cos(Math.PI))).toBeLessThan(0.01);
  });
});
