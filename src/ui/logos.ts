import type { LogoItem } from '../state';

const ACCEPTED = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp', 'image/gif'];

export function isAcceptedLogo(file: File): boolean {
  return ACCEPTED.includes(file.type) || /\.(png|svg|jpe?g|webp|gif)$/i.test(file.name);
}

let counter = 0;

/**
 * Loads an uploaded file into an image. SVGs without explicit width/height get
 * dimensions from their viewBox so they keep their aspect ratio and stay crisp
 * when drawn at large output sizes.
 */
export async function loadLogo(file: File): Promise<LogoItem> {
  let blob: Blob = file;
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) {
    const text = await file.text();
    blob = new Blob([normaliseSvg(text)], { type: 'image/svg+xml' });
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Could not read "${file.name}" as an image`);
  }
  const width = image.naturalWidth || 300;
  const height = image.naturalHeight || 150;
  return {
    id: `logo-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    name: file.name,
    url,
    image,
    width,
    height,
    scale: 1,
  };
}

export function normaliseSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return text;
  const vb = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const hasW = /^\d+(\.\d+)?(px)?$/.test(svg.getAttribute('width') ?? '');
  const hasH = /^\d+(\.\d+)?(px)?$/.test(svg.getAttribute('height') ?? '');
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && (!hasW || !hasH)) {
    // Scale up small viewBoxes so the decoded bitmap has a sensible intrinsic size.
    const k = Math.max(1, 1000 / Math.max(vb[2], vb[3]));
    svg.setAttribute('width', String(vb[2] * k));
    svg.setAttribute('height', String(vb[3] * k));
  }
  return new XMLSerializer().serializeToString(svg);
}
