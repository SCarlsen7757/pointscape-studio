import { DEFAULT_PALETTE, getPalette, isHexColor, type Palette } from './core/palettes';
import { randomSeed } from './core/rng';

export type LogoItem = {
  id: string;
  name: string;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  scale: number;
};

export type Colors = Pick<Palette, 'left' | 'right' | 'background' | 'glow'>;

export type OutputSize = { id: string; label: string; width: number; height: number };

export const OUTPUT_SIZES: readonly OutputSize[] = [
  { id: '1280x720', label: 'HD · 1280 × 720', width: 1280, height: 720 },
  { id: '1920x1080', label: 'Full HD · 1920 × 1080', width: 1920, height: 1080 },
  { id: '2560x1440', label: 'QHD · 2560 × 1440', width: 2560, height: 1440 },
  { id: '3840x2160', label: '4K · 3840 × 2160', width: 3840, height: 2160 },
  { id: '1200x630', label: 'Social card · 1200 × 630', width: 1200, height: 630 },
  { id: '1500x500', label: 'Banner · 1500 × 500', width: 1500, height: 500 },
  { id: '1080x1080', label: 'Square · 1080 × 1080', width: 1080, height: 1080 },
];

export type AppState = {
  seed: number;
  paletteId: string; // a palette id or 'custom'
  colors: Colors;
  density: number;
  waveHeight: number;
  mesh: number;
  dust: number;
  blur: number;
  glow: number;
  brightness: number;
  sizeId: string;
  format: 'png' | 'jpeg';
  logos: LogoItem[];
  logoSize: number;
  logoGap: number;
  logoY: number;
  dividers: boolean;
  dividerOpacity: number;
};

export const RENDER_KEYS = [
  'seed', 'colors', 'density', 'waveHeight', 'mesh', 'dust', 'blur', 'glow', 'brightness', 'sizeId',
] as const satisfies readonly (keyof AppState)[];

export function paletteColors(p: Palette): Colors {
  return { left: p.left, right: p.right, background: p.background, glow: p.glow };
}

export function initialState(search: string = ''): AppState {
  const q = new URLSearchParams(search);
  const palette = getPalette(q.get('palette') ?? '') ?? DEFAULT_PALETTE;
  const seedParam = Number(q.get('seed'));
  const size = OUTPUT_SIZES.find((s) => s.id === q.get('size')) ?? OUTPUT_SIZES[1];
  const colors = paletteColors(palette);
  let paletteId = palette.id;
  for (const k of ['left', 'right', 'background', 'glow'] as const) {
    const v = q.get(k);
    if (v && isHexColor(`#${v}`)) {
      colors[k] = `#${v}`;
      paletteId = 'custom';
    }
  }
  return {
    seed: Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : randomSeed(),
    paletteId,
    colors,
    density: 1,
    waveHeight: 1,
    mesh: 1,
    dust: 1,
    blur: 1,
    glow: 1,
    brightness: 1,
    sizeId: size.id,
    format: 'png',
    logos: [],
    logoSize: 0.115,
    logoGap: 0.06,
    logoY: 0.41,
    dividers: true,
    dividerOpacity: 0.55,
  };
}

export function outputSize(state: AppState): OutputSize {
  return OUTPUT_SIZES.find((s) => s.id === state.sizeId) ?? OUTPUT_SIZES[1];
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

/** Minimal observable store. */
export class Store {
  private listeners: Listener[] = [];
  constructor(public state: AppState) {}

  set(patch: Partial<AppState>): void {
    const changed = new Set<keyof AppState>();
    for (const [k, v] of Object.entries(patch) as [keyof AppState, unknown][]) {
      if (this.state[k] !== v) changed.add(k);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state, changed);
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}
