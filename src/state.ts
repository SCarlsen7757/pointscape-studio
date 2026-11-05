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
  { id: '3840x2160', label: '4K UHD · 3840 × 2160 (native)', width: 3840, height: 2160 },
  { id: '2560x1440', label: 'QHD · 2560 × 1440', width: 2560, height: 1440 },
  { id: '1920x1080', label: 'Full HD · 1920 × 1080', width: 1920, height: 1080 },
  { id: '1280x720', label: 'HD · 1280 × 720', width: 1280, height: 720 },
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

/** Default output: native 4K. */
export const DEFAULT_SIZE_ID = '3840x2160';

/** Every user setting except content (seed + uploaded logos), at its default value. */
export type Settings = Omit<AppState, 'seed' | 'logos'>;

export function defaultSettings(): Settings {
  return {
    paletteId: DEFAULT_PALETTE.id,
    colors: paletteColors(DEFAULT_PALETTE),
    density: 1,
    waveHeight: 1,
    mesh: 1,
    dust: 1,
    blur: 1,
    glow: 1,
    brightness: 1,
    sizeId: DEFAULT_SIZE_ID,
    format: 'png',
    logoSize: 0.115,
    logoGap: 0.06,
    logoY: 0.41,
    dividers: true,
    dividerOpacity: 0.55,
  };
}

/**
 * Resets every setting to its default. The current variation (seed) and the uploaded logos
 * are kept, but each logo's individual scale is reset too.
 */
export function resetSettingsPatch(state: AppState): Partial<AppState> {
  return { ...defaultSettings(), logos: state.logos.map((l) => (l.scale === 1 ? l : { ...l, scale: 1 })) };
}

export function initialState(search: string = ''): AppState {
  const q = new URLSearchParams(search);
  const palette = getPalette(q.get('palette') ?? '') ?? DEFAULT_PALETTE;
  const seedParam = Number(q.get('seed'));
  const size = OUTPUT_SIZES.find((s) => s.id === q.get('size')) ?? outputSizeById(DEFAULT_SIZE_ID);
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
    ...defaultSettings(),
    seed: Number.isFinite(seedParam) && seedParam > 0 ? Math.floor(seedParam) : randomSeed(),
    paletteId,
    colors,
    sizeId: size.id,
    logos: [],
  };
}

function outputSizeById(id: string): OutputSize {
  return OUTPUT_SIZES.find((s) => s.id === id) ?? OUTPUT_SIZES[OUTPUT_SIZES.length - 1];
}

export function outputSize(state: AppState): OutputSize {
  return outputSizeById(state.sizeId);
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
