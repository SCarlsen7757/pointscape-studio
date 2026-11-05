import { computeLayout, type Layout } from '../core/layout';
import type { AppState } from '../state';

/** Draws the rendered background plus the logo row onto a 2D canvas. */
export function compose(
  target: HTMLCanvasElement,
  background: HTMLCanvasElement,
  state: AppState,
  width: number,
  height: number,
): Layout {
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 1;
  ctx.drawImage(background, 0, 0, width, height);

  const layout = computeLayout(
    state.logos.map((l) => ({ width: l.width, height: l.height, scale: l.scale })),
    {
      canvasWidth: width,
      canvasHeight: height,
      size: state.logoSize,
      gap: state.logoGap,
      centerY: state.logoY,
      dividers: state.dividers,
    },
  );

  if (layout.dividers.length) {
    ctx.save();
    ctx.globalAlpha = state.dividerOpacity;
    for (const d of layout.dividers) {
      // Divider fades out at both ends for a softer, premium look.
      const g = ctx.createLinearGradient(0, d.y, 0, d.y + d.height);
      g.addColorStop(0, 'rgba(225,235,245,0)');
      g.addColorStop(0.18, 'rgba(225,235,245,1)');
      g.addColorStop(0.82, 'rgba(225,235,245,1)');
      g.addColorStop(1, 'rgba(225,235,245,0)');
      ctx.fillStyle = g;
      ctx.fillRect(d.x, d.y, d.thickness, d.height);
    }
    ctx.restore();
  }

  state.logos.forEach((logo, i) => {
    const r = layout.logos[i];
    if (r) ctx.drawImage(logo.image, r.x, r.y, r.width, r.height);
  });
  return layout;
}
