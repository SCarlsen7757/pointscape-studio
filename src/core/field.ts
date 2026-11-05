import { createRng, type Rng } from './rng';
import { createNoise2D, fbm, type Noise2D } from './noise';

/** User-facing generation controls. All multipliers default to 1. */
export type FieldOptions = {
  seed: number;
  /** Output aspect ratio (width / height). */
  aspect: number;
  /** Particle density multiplier (0.4 – 1.6). */
  density: number;
  /** Wave amplitude multiplier (0 – 2). */
  waveHeight: number;
  /** Amount of floating dust (0 – 2). */
  dust: number;
  /** Amount of mesh lines (0 – 2). */
  mesh: number;
};

/** Camera description shared between field generation and rendering. */
export type CameraSpec = {
  fovY: number; // degrees
  height: number;
  pitch: number; // degrees, positive looks up
  yaw: number; // degrees
  focus: number; // focus distance along view axis
};

export type PointCloud = {
  /** xyz triplets. */
  positions: Float32Array;
  /** Per-point size multiplier. */
  sizes: Float32Array;
  /** Per-point brightness multiplier. */
  brightness: Float32Array;
  /** Per-point hue jitter in [-1, 1]. */
  hueJitter: Float32Array;
  count: number;
};

export type LineSet = {
  /** Segment start xyz triplets. */
  starts: Float32Array;
  /** Segment end xyz triplets. */
  ends: Float32Array;
  /** Per-segment opacity multiplier. */
  alphas: Float32Array;
  count: number;
};

type Wave = { kx: number; kz: number; amp: number; phase: number };

export type Variation = {
  waves: Wave[];
  gridRotation: number;
  valley: number;
  swellX: number;
  swellZ: number;
  swellAmp: number;
  swellWidth: number;
  noiseScale: number;
  noiseAmp: number;
  /** -1 favours the left upper corner for dust, +1 the right. */
  dustSide: number;
  jitter: number;
};

export type Field = {
  camera: CameraSpec;
  terrain: PointCloud;
  dust: PointCloud;
  lines: LineSet;
  /** Seed-derived variation parameters (useful for debugging / tests). */
  variation: Variation;
};

export const DEFAULT_FIELD_OPTIONS: Omit<FieldOptions, 'seed' | 'aspect'> = {
  density: 1,
  waveHeight: 1,
  dust: 1,
  mesh: 1,
};

const DEG = Math.PI / 180;
export const Z_NEAR = 2.5;
export const Z_FAR = 60;

export function deriveVariation(rng: Rng): Variation {
  const waveCount = rng.int(3, 4);
  const waves: Wave[] = [];
  for (let i = 0; i < waveCount; i++) {
    // Primary ridges run roughly across the view (wave vector mostly along z),
    // secondary components add diagonal interference.
    const primary = i === 0;
    const angle = (primary ? rng.range(-25, 25) : rng.range(-80, 80)) * DEG;
    const wavelength = primary ? rng.range(11, 17) : rng.range(6, 12);
    const k = (2 * Math.PI) / wavelength;
    waves.push({
      kx: Math.sin(angle) * k,
      kz: Math.cos(angle) * k,
      amp: primary ? rng.range(0.7, 1.0) : rng.range(0.2, 0.45),
      phase: rng.range(0, Math.PI * 2),
    });
  }
  return {
    waves,
    // Rotated well away from the view axis so grid columns don't stack into vertical streaks.
    gridRotation: rng.range(18, 32) * (rng.chance(0.5) ? 1 : -1) * DEG,
    valley: rng.range(0.8, 1.3),
    swellX: rng.range(-9, 9),
    swellZ: rng.range(14, 24),
    swellAmp: rng.range(0.35, 0.9),
    swellWidth: rng.range(4, 7),
    noiseScale: rng.range(0.06, 0.11),
    noiseAmp: rng.range(0.25, 0.45),
    dustSide: rng.range(-1, 1),
    jitter: rng.range(0.26, 0.34),
  };
}

export function createCamera(rng: Rng): CameraSpec {
  return {
    fovY: 40,
    height: rng.range(1.05, 1.3),
    pitch: rng.range(2.4, 3.4),
    yaw: rng.range(-2.5, 2.5),
    focus: rng.range(11, 14),
  };
}

/** Terrain surface height at world (x, z). z is negative in front of the camera. */
export function terrainHeight(
  v: Variation,
  noise: Noise2D,
  waveHeight: number,
  tanHalfX: number,
  x: number,
  z: number,
  limit = Infinity,
): number {
  return terrainWaves(v, noise, waveHeight, x, z, limit) + valleyLift(v, tanHalfX, x, z);
}

/** Valley: terrain climbs towards the left / right edges of the frame, framing the empty centre. */
export function valleyLift(v: Variation, tanHalfX: number, x: number, z: number): number {
  const depth = Math.max(-z, 1);
  const u = x / (depth * tanHalfX);
  // Faded in with depth so the edges right in front of the camera stay low (no bokeh wall).
  return v.valley * u * u * depth * 0.065 * smoothstep(3, 10, depth);
}

/** The rolling-wave part of the terrain (without the valley lift). */
export function terrainWaves(
  v: Variation,
  noise: Noise2D,
  waveHeight: number,
  x: number,
  z: number,
  limit = Infinity,
): number {
  let h = 0;
  for (const w of v.waves) h += w.amp * Math.sin(w.kx * x + w.kz * z + w.phase);
  h += v.noiseAmp * fbm(noise, x * v.noiseScale, z * v.noiseScale, 4);
  const dz = -z - v.swellZ;
  const dx = x - v.swellX;
  h += v.swellAmp * Math.exp(-(dx * dx + dz * dz * 0.5) / (v.swellWidth * v.swellWidth));
  h *= waveHeight;
  // Soft-limit wave crests so they never rise into the logo area.
  if (Number.isFinite(limit)) h = limit * Math.tanh(h / limit);
  // Calmer waves right in front of the camera so near ridges don't form a wall of bokeh.
  return h * (0.5 + 0.5 * smoothstep(3, 9, Math.max(-z, 0)));
}

export function generateField(opts: FieldOptions): Field {
  const rng = createRng(opts.seed);
  const camera = createCamera(rng);
  const variation = deriveVariation(rng);
  const noise = createNoise2D(opts.seed);
  const detailNoise = createNoise2D(`${opts.seed}:detail`);

  const tanHalfY = Math.tan((camera.fovY * DEG) / 2);
  const tanHalfX = tanHalfY * opts.aspect;

  // Grid spacing tuned for native 4K detail.
  const spacing = 0.1 / Math.sqrt(Math.max(0.2, opts.density));
  const cosR = Math.cos(variation.gridRotation);
  const sinR = Math.sin(variation.gridRotation);

  // Grid extents (in rotated grid space) large enough to cover the frustum.
  const maxHalfW = Z_FAR * tanHalfX * 1.25 + 4;
  const reach = Math.hypot(maxHalfW, Z_FAR) + 2;
  const n = Math.ceil(reach / spacing);

  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const sizes: number[] = [];
  const bright: number[] = [];
  const hue: number[] = [];
  const facingArr: number[] = [];

  const cols = 2 * n + 1;
  // Rows extend in both directions so a rotated grid still covers the frustum.
  const rows = 2 * n + 1;
  const index = new Int32Array(cols * rows).fill(-1);
  // Max angle (below the horizontal) of near terrain: 76% down the frame, corrected for pitch.
  const nearClampAngle = Math.atan(0.52 * tanHalfY) - camera.pitch * DEG;
  const crest: number[] = [];
  const nearArr: number[] = [];
  // Near-field heights are compressed towards this baseline (uniformly, so wave shapes are kept).
  const nearBase = -camera.height * 0.4;
  let nearK = 1;
  const limit = camera.height * 0.7;
  let wMin = Infinity;
  let wMax = -Infinity;

  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const gx = i * spacing + (rng.next() - 0.5) * spacing * variation.jitter * 2;
      const gz = -j * spacing + (rng.next() - 0.5) * spacing * 0.9;
      const x = gx * cosR - gz * sinR;
      const z = gx * sinR + gz * cosR;
      const depth = -z;
      if (depth < Z_NEAR || depth > Z_FAR) continue;
      // Frustum cull horizontally with a margin so blurred edge points still contribute.
      if (Math.abs(x) > depth * tanHalfX * 1.18 + 1.5) continue;
      // Thin out randomly for organic deviation, more so in the distance to
      // avoid the horizon saturating.
      // Thin the out-of-focus foreground too, so it reads as scattered bokeh over deep black.
      const thin = 0.06 + 0.7 * smoothstep(10, Z_FAR, depth) + 0.78 * smoothstep(camera.focus * 0.85, Z_NEAR + 0.5, depth);
      if (rng.next() < thin) continue;

      const w = terrainWaves(variation, noise, opts.waveHeight, x, z, limit);
      const y = w + valleyLift(variation, tanHalfX, x, z) + rng.normal() * 0.012;
      // Track how much the near field must be compressed to stay below the clamp line.
      const near = smoothstep(camera.focus * 0.95, camera.focus * 0.6, depth);
      nearArr.push(near);
      if (near > 0.02) {
        const yMax = camera.height - depth * Math.tan(nearClampAngle);
        if (y > yMax) {
          const r = (yMax - nearBase) / Math.max(1e-4, y - nearBase);
          nearK = Math.min(nearK, 1 - (1 - r) / near);
        }
      }
      // Slope facing the camera (surface rising away from the viewer) catches more light.
      const wFar = terrainWaves(variation, noise, opts.waveHeight, x, z - 0.25, limit);
      const facing = smoothstep(-0.15, 0.35, (wFar - w) / 0.25);
      wMin = Math.min(wMin, w);
      wMax = Math.max(wMax, w);
      crest.push(w + facing * 0.0001);
      facingArr.push(facing);
      index[(j + n) * cols + (i + n)] = px.length;
      px.push(x);
      py.push(y);
      pz.push(z);
      sizes.push(0.6 + rng.next() * 0.8 + (rng.chance(0.04) ? rng.range(0.5, 1.2) : 0));
      const patch = 0.65 + 0.55 * (fbm(detailNoise, x * 0.07, z * 0.07, 3) * 0.5 + 0.5);
      let b = (0.55 + 0.45 * rng.next()) * patch;
      if (rng.chance(0.035)) b *= rng.range(1.8, 3.2);
      bright.push(b);
      hue.push(rng.range(-1, 1));
    }
  }

  // Near-camera compression: terrain in front of the focal zone never rises above ~76% of the
  // frame height, so close ridges can't form a wall of bokeh over the scene. Scaling (not
  // clamping) keeps the shapes intact and avoids points piling up on one screen line.
  nearK = Math.max(0, nearK);
  if (nearK < 1) {
    for (let k = 0; k < py.length; k++) {
      const s = 1 - nearArr[k] * (1 - nearK);
      if (s < 1) py[k] = nearBase + (py[k] - nearBase) * s;
    }
  }

  // Ridge lighting: points on wave crests and on slopes facing the camera are brighter.
  // Uses the wave height only, so the valley-lifted edges don't steal the highlight.
  const range = Math.max(1e-3, wMax - wMin);
  for (let k = 0; k < py.length; k++) {
    const t = (crest[k] - wMin) / range;
    bright[k] *= (0.35 + 2.1 * Math.pow(t, 2.2)) * (0.7 + 0.55 * facingArr[k]);
  }

  const terrain = packCloud(px, py, pz, sizes, bright, hue);

  // Mesh lines between grid neighbours, masked into organic patches.
  const ls: number[] = [];
  const le: number[] = [];
  const la: number[] = [];
  const meshAmount = Math.max(0, opts.mesh);
  if (meshAmount > 0) {
    const maskNoise = createNoise2D(`${opts.seed}:mesh`);
    const threshold = 0.25 - 0.25 * Math.min(meshAmount, 2);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const a = index[(j + n) * cols + (i + n)];
        if (a < 0) continue;
        const neighbours: number[] = [];
        if (i < n) neighbours.push(index[(j + n) * cols + (i + n + 1)]);
        // Only every 4th depth-wise link: rows read as contour lines rather than a triangle network.
        if (j < n && (i & 3) === 0) neighbours.push(index[(j + n + 1) * cols + (i + n)]);
        for (const b of neighbours) {
          if (b < 0) continue;
          const mx = (px[a] + px[b]) * 0.5;
          const mz = (pz[a] + pz[b]) * 0.5;
          const m = fbm(maskNoise, mx * 0.05, mz * 0.05, 3);
          if (m < threshold) continue;
          if (rng.next() < 0.2) continue;
          ls.push(px[a], py[a], pz[a]);
          le.push(px[b], py[b], pz[b]);
          const strength = Math.min(1, (m - threshold) * 2.2);
          la.push(strength * (0.6 + 0.4 * rng.next()) * Math.min(bright[a], bright[b], 1.6));
        }
      }
    }
  }
  const lines: LineSet = {
    starts: new Float32Array(ls),
    ends: new Float32Array(le),
    alphas: new Float32Array(la),
    count: la.length,
  };

  const dust = generateDust(rng, opts, camera, variation, tanHalfX, tanHalfY);

  return { camera, terrain, dust, lines, variation };
}

function generateDust(
  rng: Rng,
  opts: FieldOptions,
  camera: CameraSpec,
  v: Variation,
  tanHalfX: number,
  tanHalfY: number,
): PointCloud {
  const target = Math.round(18000 * Math.max(0, opts.dust));
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const sizes: number[] = [];
  const bright: number[] = [];
  const hue: number[] = [];
  const clusterNoise = createNoise2D(`${opts.seed}:dust`);
  const pitch = camera.pitch * DEG;
  let attempts = 0;
  while (px.length < target && attempts < target * 40) {
    attempts++;
    // Log-uniform depth gives more near-camera bokeh relative to volume.
    const depth = rng.chance(0.012) ? rng.range(1.5, 4) : Math.exp(rng.range(Math.log(7), Math.log(40)));
    // Screen-space position (u: -1..1 left→right, s: -1..1 bottom→top).
    const u = rng.range(-1.15, 1.15);
    const s = rng.range(-0.6, 1.1);
    const side = Math.abs(u);
    // Density concentrated in the upper corners, keeping the logo area clear.
    const cornerBias = u < 0 ? 1 - v.dustSide * 0.55 : 1 + v.dustSide * 0.55;
    const up = Math.max(0, s);
    const cluster = Math.pow(Math.max(0, 0.5 + 0.6 * fbm(clusterNoise, u * 2.6, s * 2.6, 3)), 1.6);
    let w = smoothstep(0.2, 1.0, side) * (0.25 + 0.75 * up) * cornerBias * cluster;
    // Faint sparse dust everywhere above the terrain.
    w = Math.max(w, 0.02);
    // Keep the logo band essentially empty.
    if (s > -0.3 && s < 0.9) w *= 0.03 + 0.97 * smoothstep(0.42, 0.62, side);
    if (rng.next() > w) continue;

    const x = u * depth * tanHalfX;
    const viewY = s * depth * tanHalfY;
    // Un-pitch the camera ray to obtain world y / z.
    const y = camera.height + viewY * Math.cos(pitch) + depth * Math.sin(pitch);
    const z = -depth * Math.cos(pitch) + viewY * Math.sin(pitch);
    px.push(x);
    py.push(y);
    pz.push(z);
    sizes.push(0.6 + rng.next() * 0.8);
    let b = 0.3 + 0.7 * Math.pow(rng.next(), 2);
    if (rng.chance(0.06)) b *= 2.4;
    bright.push(b);
    hue.push(rng.range(-1, 1));
  }
  return packCloud(px, py, pz, sizes, bright, hue);
}

function packCloud(
  px: number[],
  py: number[],
  pz: number[],
  sizes: number[],
  bright: number[],
  hue: number[],
): PointCloud {
  const count = px.length;
  const positions = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    positions[k * 3] = px[k];
    positions[k * 3 + 1] = py[k];
    positions[k * 3 + 2] = pz[k];
  }
  return {
    positions,
    sizes: new Float32Array(sizes),
    brightness: new Float32Array(bright),
    hueJitter: new Float32Array(hue),
    count,
  };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
