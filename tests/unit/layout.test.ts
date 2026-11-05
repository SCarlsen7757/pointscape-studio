import { describe, expect, it } from 'vitest';
import { computeLayout, type LayoutOptions } from '../../src/core/layout';

const opts: LayoutOptions = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  size: 0.115,
  gap: 0.06,
  centerY: 0.41,
  dividers: true,
};

describe('computeLayout', () => {
  it('returns an empty layout without logos', () => {
    expect(computeLayout([], opts)).toEqual({ logos: [], dividers: [], bounds: null });
  });

  it('centres a single logo', () => {
    const l = computeLayout([{ width: 200, height: 100, scale: 1 }], opts);
    const r = l.logos[0];
    expect(r.x + r.width / 2).toBeCloseTo(960);
    expect(r.y + r.height / 2).toBeCloseTo(1080 * 0.41);
    expect(r.width / r.height).toBeCloseTo(2);
    expect(l.dividers).toHaveLength(0);
  });

  it('normalises logos by visual area', () => {
    const l = computeLayout(
      [
        { width: 100, height: 100, scale: 1 },
        { width: 400, height: 25, scale: 1 },
      ],
      opts,
    );
    const [a, b] = l.logos;
    expect(a.width * a.height).toBeCloseTo(b.width * b.height, 0);
  });

  it('clamps tall logos', () => {
    const l = computeLayout([{ width: 50, height: 500, scale: 1 }], opts);
    expect(l.logos[0].height).toBeLessThanOrEqual(1080 * 0.115 * 1.25 + 1e-6);
  });

  it('places dividers centred in the gaps', () => {
    const l = computeLayout(
      [
        { width: 100, height: 120, scale: 1 },
        { width: 420, height: 80, scale: 1 },
        { width: 300, height: 100, scale: 1 },
      ],
      opts,
    );
    expect(l.dividers).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const left = l.logos[i];
      const right = l.logos[i + 1];
      const d = l.dividers[i];
      const mid = (left.x + left.width + right.x) / 2;
      expect(d.x + d.thickness / 2).toBeCloseTo(mid);
    }
    // Row is centred as a whole.
    const b = l.bounds!;
    expect(b.x + b.width / 2).toBeCloseTo(960);
  });

  it('shrinks the row to fit the canvas', () => {
    const many = Array.from({ length: 8 }, () => ({ width: 600, height: 100, scale: 1 }));
    const l = computeLayout(many, opts);
    expect(l.bounds!.width).toBeLessThanOrEqual(1920 * 0.88 + 1e-6);
    expect(l.logos[0].x).toBeGreaterThanOrEqual(0);
    const last = l.logos[l.logos.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(1920);
  });

  it('honours per-logo scale', () => {
    const l = computeLayout(
      [
        { width: 100, height: 100, scale: 1 },
        { width: 100, height: 100, scale: 1.5 },
      ],
      { ...opts, dividers: false },
    );
    expect(l.logos[1].width / l.logos[0].width).toBeCloseTo(1.5);
  });
});
