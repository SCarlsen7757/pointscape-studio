import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { createNoise2D, fbm } from '../../src/core/noise';
import { generateField, Z_FAR, Z_NEAR } from '../../src/core/field';
import { PALETTES, hexToRgb, isHexColor } from '../../src/core/palettes';
import { initialState, Store, DEFAULT_SIZE_ID, defaultSettings, resetSettingsPatch, type LogoItem } from '../../src/state';
import { nativeRenderSize } from '../../src/core/resolution';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });

  it('stays in range', () => {
    const r = createRng('range');
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const k = r.int(3, 5);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(5);
    }
  });
});

describe('noise', () => {
  it('is bounded and seed dependent', () => {
    const n1 = createNoise2D(1);
    const n2 = createNoise2D(2);
    let diff = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.137;
      const y = i * 0.071;
      const v = n1(x, y);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
      expect(Math.abs(fbm(n1, x, y))).toBeLessThanOrEqual(1.01);
      diff += Math.abs(v - n2(x, y));
    }
    expect(diff).toBeGreaterThan(100);
  });
});

describe('field generation', () => {
  const base = { aspect: 16 / 9, density: 1, waveHeight: 1, dust: 1, mesh: 1 };

  it('is deterministic for a seed and varies between seeds', () => {
    const a = generateField({ ...base, seed: 777 });
    const b = generateField({ ...base, seed: 777 });
    const c = generateField({ ...base, seed: 778 });
    expect(a.terrain.count).toBe(b.terrain.count);
    expect(a.terrain.positions).toEqual(b.terrain.positions);
    expect(a.variation).toEqual(b.variation);
    expect(c.variation).not.toEqual(a.variation);
  });

  it('produces a substantial cloud with mesh lines and dust', () => {
    const f = generateField({ ...base, seed: 1 });
    expect(f.terrain.count).toBeGreaterThan(50_000);
    expect(f.lines.count).toBeGreaterThan(5_000);
    expect(f.dust.count).toBeGreaterThan(5_000);
    expect(f.terrain.positions.length).toBe(f.terrain.count * 3);
    expect(f.lines.starts.length).toBe(f.lines.count * 3);
  });

  it('keeps terrain inside the depth range and out of the logo area', () => {
    for (const seed of [1, 2, 3, 777, 4242]) {
      const f = generateField({ ...base, seed, waveHeight: 1.8 });
      const p = f.terrain.positions;
      const tanHalfY = Math.tan((f.camera.fovY * Math.PI) / 360);
      const tanHalfX = tanHalfY * base.aspect;
      const pitch = (f.camera.pitch * Math.PI) / 180;
      let highest = -Infinity;
      for (let i = 0; i < f.terrain.count; i++) {
        const x = p[i * 3];
        const y = p[i * 3 + 1] - f.camera.height;
        const z = p[i * 3 + 2];
        expect(-z).toBeGreaterThanOrEqual(Z_NEAR);
        expect(-z).toBeLessThanOrEqual(Z_FAR);
        const depth = -z * Math.cos(pitch) + y * Math.sin(pitch);
        const s = (y * Math.cos(pitch) + z * Math.sin(pitch)) / (depth * tanHalfY);
        if (Math.abs(x / (depth * tanHalfX)) < 0.33) highest = Math.max(highest, s);
      }
      // Logo row sits at ~41% from the top (s ≈ +0.18). Terrain in the central
      // third must stay below the image centre, even at maximum wave height.
      expect(highest).toBeLessThan(0);
    }
  });

  it('scales with the density, dust and mesh controls', () => {
    const f1 = generateField({ ...base, seed: 5 });
    const dense = generateField({ ...base, seed: 5, density: 1.5 });
    const none = generateField({ ...base, seed: 5, dust: 0, mesh: 0 });
    expect(dense.terrain.count).toBeGreaterThan(f1.terrain.count * 1.3);
    expect(none.dust.count).toBe(0);
    expect(none.lines.count).toBe(0);
  });

  it('keeps dust out of the central logo band', () => {
    const f = generateField({ ...base, seed: 99, dust: 2 });
    const tanHalfY = Math.tan((f.camera.fovY * Math.PI) / 360);
    const tanHalfX = tanHalfY * base.aspect;
    const pitch = (f.camera.pitch * Math.PI) / 180;
    let inBand = 0;
    for (let i = 0; i < f.dust.count; i++) {
      const x = f.dust.positions[i * 3];
      const y = f.dust.positions[i * 3 + 1] - f.camera.height;
      const z = f.dust.positions[i * 3 + 2];
      // Rotate into camera space (pitch only) and project.
      const depth = -z * Math.cos(pitch) + y * Math.sin(pitch);
      const vy = y * Math.cos(pitch) + z * Math.sin(pitch);
      const u = x / (depth * tanHalfX);
      const s = vy / (depth * tanHalfY);
      if (Math.abs(u) < 0.3 && s > -0.1 && s < 0.45) inBand++;
    }
    expect(inBand / f.dust.count).toBeLessThan(0.02);
  });
});

describe('native 4K rendering', () => {
  it('renders every output size at native 4K resolution', () => {
    expect(nativeRenderSize(3840, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(nativeRenderSize(1920, 1080)).toEqual({ width: 3840, height: 2160 });
    expect(nativeRenderSize(1280, 720)).toEqual({ width: 3840, height: 2160 });
    expect(nativeRenderSize(1080, 1080)).toEqual({ width: 2160, height: 2160 });
    expect(nativeRenderSize(1500, 500)).toEqual({ width: 3840, height: 1280 });
    expect(nativeRenderSize(1200, 630)).toEqual({ width: 3840, height: 2016 });
  });

  it('never renders below the requested size', () => {
    expect(nativeRenderSize(7680, 4320)).toEqual({ width: 7680, height: 4320 });
  });
});

describe('palettes', () => {
  it('include the Neon Tropic preset', () => {
    const p = PALETTES.find((x) => x.id === 'neon-tropic');
    expect(p?.name).toBe('Neon Tropic');
    const [r, g, b] = hexToRgb(p!.left);
    expect(r).toBeGreaterThan(200); // hot pink
    expect(b).toBeGreaterThan(g);
  });

  it('are all valid', () => {
    const ids = new Set<string>();
    for (const p of PALETTES) {
      for (const c of [p.left, p.right, p.background, p.glow]) expect(isHexColor(c)).toBe(true);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      // Backgrounds must be dark for the look to work.
      const [r, g, b] = hexToRgb(p.background);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(20);
    }
  });
});

describe('state', () => {
  it('reads seed, palette, size and custom colours from the query string', () => {
    const s = initialState('?seed=123&palette=amber&size=3840x2160');
    expect(s.seed).toBe(123);
    expect(s.paletteId).toBe('amber');
    expect(s.sizeId).toBe('3840x2160');
    const c = initialState('?left=ff0000');
    expect(c.paletteId).toBe('custom');
    expect(c.colors.left).toBe('#ff0000');
  });

  it('falls back to defaults for invalid values', () => {
    const s = initialState('?seed=abc&palette=nope&size=1x1');
    expect(s.seed).toBeGreaterThan(0);
    expect(s.paletteId).toBe('teal-frost');
    expect(s.sizeId).toBe(DEFAULT_SIZE_ID);
  });

  it('defaults to native 4K output', () => {
    expect(DEFAULT_SIZE_ID).toBe('3840x2160');
    expect(initialState('').sizeId).toBe('3840x2160');
  });

  it('reset restores every setting but keeps the seed and logos', () => {
    const logo = { id: 'a', name: 'a.svg', url: '', image: {} as HTMLImageElement, width: 10, height: 10, scale: 1.7 } as LogoItem;
    const s = {
      ...initialState('?seed=42&palette=amber&size=1280x720'),
      density: 1.4,
      blur: 0.2,
      logoSize: 0.2,
      dividers: false,
      format: 'jpeg' as const,
      logos: [logo],
    };
    const store = new Store(s);
    store.set(resetSettingsPatch(store.state));
    const { logos, seed, ...rest } = store.state;
    expect(seed).toBe(42);
    expect(logos).toHaveLength(1);
    expect(logos[0].id).toBe('a');
    expect(logos[0].scale).toBe(1);
    expect(rest).toEqual(defaultSettings());
  });

  it('store notifies only about changed keys', () => {
    const store = new Store(initialState('?seed=1'));
    const seen: string[][] = [];
    store.subscribe((_s, changed) => seen.push([...changed]));
    store.set({ seed: 1 });
    store.set({ seed: 2, density: 1 });
    expect(seen).toEqual([['seed']]);
  });
});
