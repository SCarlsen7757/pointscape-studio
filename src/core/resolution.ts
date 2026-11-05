/** Every image is rendered at (up to) native 4K resolution and downsampled to the output size. */
export const NATIVE_WIDTH = 3840;
export const NATIVE_HEIGHT = 2160;

/**
 * Internal render size for an output size: the output aspect ratio scaled up to fill the
 * native 4K box (never scaled down). Smaller outputs are supersampled from this.
 */
export function nativeRenderSize(width: number, height: number): { width: number; height: number } {
  const k = Math.max(1, Math.min(NATIVE_WIDTH / width, NATIVE_HEIGHT / height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}
