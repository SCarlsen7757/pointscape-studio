/**
 * Colour schemes. Colours are authored as sRGB hex strings.
 *  - left / right: particle colours, blended across the image horizontally.
 *  - background: the deep base colour of the backdrop.
 *  - glow: the soft haze that lights the backdrop from the top centre.
 */
export type Palette = {
  id: string;
  name: string;
  left: string;
  right: string;
  background: string;
  glow: string;
};

export const PALETTES: readonly Palette[] = [
  { id: 'teal-frost', name: 'Teal Frost', left: '#16d5e6', right: '#d4e5f7', background: '#03080e', glow: '#173246' },
  { id: 'arctic', name: 'Arctic Blue', left: '#2f8cff', right: '#cfe6ff', background: '#02060e', glow: '#13284a' },
  { id: 'amber', name: 'Amber Forge', left: '#ff8a1c', right: '#ffe1b3', background: '#080503', glow: '#33200f' },
  { id: 'violet', name: 'Violet Pulse', left: '#8b5cff', right: '#ff7fd6', background: '#05030c', glow: '#26173f' },
  { id: 'emerald', name: 'Emerald Grid', left: '#14e08c', right: '#d2ffe9', background: '#020905', glow: '#123426' },
  { id: 'crimson', name: 'Crimson Steel', left: '#ff3048', right: '#e3e8f2', background: '#0a0306', glow: '#33141c' },
  { id: 'silver', name: 'Mono Silver', left: '#8fa6bf', right: '#ffffff', background: '#05070a', glow: '#1f2832' },
  { id: 'neon-tropic', name: 'Neon Tropic', left: '#ff2e9a', right: '#00f0d0', background: '#07030c', glow: '#3a0f38' },
];

export const DEFAULT_PALETTE: Palette = PALETTES[0];

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
