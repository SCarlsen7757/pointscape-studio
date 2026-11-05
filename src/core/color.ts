/**
 * OKLab / OKLCH colour helpers (Björn Ottosson). Colours are blended in OKLCH so a gradient
 * between two saturated hues (e.g. hot pink → turquoise) keeps its saturation instead of
 * fading through grey as a plain RGB blend would.
 *
 * All RGB values here are *linear* sRGB in [0, 1].
 */
export type Rgb = [number, number, number];
/** [L, C, h] — lightness, chroma, hue in radians. */
export type Lch = [number, number, number];

/** Below this chroma a colour is treated as neutral and borrows the other end's hue. */
const NEUTRAL_CHROMA = 0.03;

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToOklch([r, g, b]: Rgb): Lch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

export function oklchToLinear([L, C, h]: Lch): Rgb {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * Prepares two gradient end points: when one end is (nearly) neutral its hue is meaningless,
 * so it takes the other end's hue — the blend then only fades chroma, without a hue swing.
 */
export function gradientEnds(a: Rgb, b: Rgb): [Lch, Lch] {
  const la = linearToOklch(a);
  const lb = linearToOklch(b);
  if (la[1] < NEUTRAL_CHROMA && lb[1] >= NEUTRAL_CHROMA) la[2] = lb[2];
  if (lb[1] < NEUTRAL_CHROMA && la[1] >= NEUTRAL_CHROMA) lb[2] = la[2];
  return [la, lb];
}

/** OKLCH blend along the shorter hue arc. Must match `paletteAt` in the shaders. */
export function mixOklch(a: Lch, b: Lch, t: number): Lch {
  let dh = b[2] - a[2];
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dh * t];
}
