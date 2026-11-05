/** Pure logo layout maths (no DOM), so it can be unit-tested. */

export type LogoBox = {
  /** Intrinsic width of the logo image (any unit). */
  width: number;
  /** Intrinsic height of the logo image. */
  height: number;
  /** Per-logo user scale (1 = default). */
  scale: number;
};

export type LayoutOptions = {
  canvasWidth: number;
  canvasHeight: number;
  /** Visual size of each logo as a fraction of canvas height (geometric mean of w × h). */
  size: number;
  /** Gap between logos as a fraction of canvas width. */
  gap: number;
  /** Vertical centre of the logo row as a fraction of canvas height. */
  centerY: number;
  /** Draw thin vertical dividers between logos. */
  dividers: boolean;
  /** Maximum fraction of the canvas width the row may occupy. */
  maxRowWidth?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };
export type Divider = { x: number; y: number; height: number; thickness: number };
export type Layout = { logos: Rect[]; dividers: Divider[]; bounds: Rect | null };

/**
 * Logos are normalised by visual area rather than height, so a square icon and a
 * wide wordmark read with similar weight. Tall logos are clamped, and the whole
 * row is scaled down uniformly if it would exceed `maxRowWidth`.
 */
export function computeLayout(items: LogoBox[], o: LayoutOptions): Layout {
  const W = o.canvasWidth;
  const H = o.canvasHeight;
  if (items.length === 0) return { logos: [], dividers: [], bounds: null };

  const target = o.size * H;
  const sized = items.map((it) => {
    const w0 = Math.max(1, it.width);
    const h0 = Math.max(1, it.height);
    const t = target * it.scale;
    let s = t / Math.sqrt(w0 * h0);
    const maxH = t * 1.25;
    if (h0 * s > maxH) s = maxH / h0;
    return { w: w0 * s, h: h0 * s };
  });

  let gap = o.gap * W;
  let total = sized.reduce((a, b) => a + b.w, 0) + gap * (items.length - 1);
  const maxRow = (o.maxRowWidth ?? 0.88) * W;
  let k = 1;
  if (total > maxRow) {
    k = maxRow / total;
    gap *= k;
    total = maxRow;
  }

  const cy = o.centerY * H;
  let x = (W - total) / 2;
  const logos: Rect[] = [];
  const dividers: Divider[] = [];
  const tallest = Math.max(...sized.map((s) => s.h * k));
  const thickness = Math.max(1, (1.6 * H) / 1080);

  sized.forEach((s, i) => {
    const w = s.w * k;
    const h = s.h * k;
    logos.push({ x, y: cy - h / 2, width: w, height: h });
    x += w;
    if (i < sized.length - 1) {
      if (o.dividers) {
        const dh = tallest * 0.72;
        dividers.push({ x: x + gap / 2 - thickness / 2, y: cy - dh / 2, height: dh, thickness });
      }
      x += gap;
    }
  });

  const minY = Math.min(...logos.map((r) => r.y));
  const maxY = Math.max(...logos.map((r) => r.y + r.height));
  return {
    logos,
    dividers,
    bounds: { x: (W - total) / 2, y: minY, width: total, height: maxY - minY },
  };
}
