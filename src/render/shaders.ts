/**
 * GLSL shaders for the point-cloud backdrop.
 *
 * Depth of field is simulated per particle: each point's sprite grows by its
 * circle of confusion (thin-lens approximation) and its intensity is spread
 * over the larger area, producing soft bokeh discs in the foreground and fine
 * crisp points at the focus distance.
 */

const DOF_COMMON = /* glsl */ `
  uniform float uPxScale;     // render height / 2160 — pixel sizes are authored for native 4K
  uniform float uFocalPx;     // focal length in pixels
  uniform float uFocus;       // focus distance (view-space depth)
  uniform float uAperture;    // aperture (world units)
  uniform float uFarBlur;     // blur multiplier behind the focus plane
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uLchL;         // left colour in OKLCH (L, C, hue radians)
  uniform vec3 uLchR;         // right colour in OKLCH
  uniform vec3 uHaze;

  vec3 oklchToLinear(vec3 lch) {
    float A = lch.y * cos(lch.z);
    float B = lch.y * sin(lch.z);
    float l = lch.x + 0.3963377774 * A + 0.2158037573 * B;
    float m = lch.x - 0.1055613458 * A - 0.0638541728 * B;
    float s = lch.x - 0.0894841775 * A - 1.2914855480 * B;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return max(vec3(
       4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), 0.0);
  }

  float cocPx(float depth) {
    float d = 1.0 / uFocus - 1.0 / depth;
    // A crisp focal zone around the wave band: no blur within ~12% in front of the
    // focus distance and up to ~2x behind it, then a smooth ramp.
    float rel = (depth - uFocus) / uFocus;
    float ramp = rel < 0.0 ? smoothstep(0.12, 0.4, -rel) : smoothstep(0.6, 2.2, rel);
    return uAperture * uFocalPx * (d > 0.0 ? d * uFarBlur : -d) * ramp;
  }

  vec3 paletteAt(float screenT, float jitter) {
    float t = smoothstep(0.0, 1.0, screenT + jitter * 0.07);
    // Blend in OKLCH along the shorter hue arc: two saturated hues stay saturated
    // through the middle instead of fading through grey (see src/core/color.ts).
    float dh = uLchR.z - uLchL.z;
    dh -= 6.28318530718 * floor((dh + 3.14159265359) / 6.28318530718);
    vec3 lch = vec3(mix(uLchL.xy, uLchR.xy, t), uLchL.z + dh * t);
    return oklchToLinear(lch);
  }

  float fogAt(float depth) {
    return smoothstep(uFogFar, uFogNear, depth);
  }
`;

export const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute float aBright;
  attribute float aHue;
  uniform float uSizeWorld;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform float uIntensity;
  uniform float uBokehGain;
  ${DOF_COMMON}

  varying vec3 vColor;
  varying float vBlur;
  varying float vEdge;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    gl_Position = projectionMatrix * mv;

    float sharp = max(uSizeWorld * aSize * uFocalPx / depth, uMinPx * uPxScale * aSize);
    // Slight per-particle variation of the blur so bokeh discs differ in size.
    float coc = cocPx(depth) * (1.0 + 0.3 * aHue);
    float size = min(sqrt(sharp * sharp + coc * coc), uMaxPx * uPxScale);
    // Spread energy over the blurred disc, but keep bokeh visible (artistic, not physical):
    // larger discs get fainter, so close particles overlap softly instead of reading as polka dots.
    float energy = pow(sharp / size, 1.35);
    float bokeh = smoothstep(0.35, 0.75, coc / size);
    energy = max(energy, bokeh * uBokehGain * min(aBright, 1.3) * 0.5 * pow(clamp(28.0 * uPxScale / size, 0.25, 1.6), 0.7));
    // Sparkle points must not become hot discs once out of focus.
    float b = mix(aBright, min(aBright, 1.3), bokeh);

    // Anti-aliasing margin in real pixels (renders are always near-4K, so this stays crisp).
    float aa = 1.5;
    gl_PointSize = size + aa;
    vEdge = size / (size + aa);
    vBlur = coc / size;

    float screenT = gl_Position.x / gl_Position.w * 0.5 + 0.5;
    vec3 col = paletteAt(screenT, aHue);
    float fog = fogAt(depth);
    col = mix(uHaze, col, 0.35 + 0.65 * fog);
    vColor = col * b * uIntensity * energy * fog;
    // Hard cap on out-of-focus discs so overlapping or sparkly bokeh never turns into hot spots.
    float peak = max(max(vColor.r, vColor.g), vColor.b);
    float cap = mix(100.0, 0.2 * (0.45 + 0.75 * fract(aHue * 7.31 + 0.5)), bokeh);
    vColor *= min(1.0, cap / max(peak, 1e-4));
  }
`;

export const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vBlur;
  varying float vEdge;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c) / vEdge;
    if (r > 1.08) discard;
    // In focus: soft gaussian dot. Out of focus: flat disc with a faint bright rim.
    // Tight bright core plus a faint halo: crisp points that still glow.
    float sharp = exp(-r * r * 9.0) + 0.22 * exp(-r * r * 2.2);
    // Soft-edged disc, slightly brighter towards the rim, with a gentle inner falloff.
    float disc = (1.0 - smoothstep(0.62, 1.02, r)) * (0.7 + 0.22 * smoothstep(0.35, 0.85, r));
    float m = mix(sharp, disc, smoothstep(0.25, 0.7, vBlur));
    gl_FragColor = vec4(vColor * m, 1.0);
  }
`;

/** Instanced screen-space quads for anti-aliased, resolution-independent mesh lines. */
export const lineVertex = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aAlpha;
  uniform vec2 uResolution;
  uniform float uWidthPx;
  uniform float uLineAlpha;
  ${DOF_COMMON}

  varying vec3 vColor;
  varying float vSide;

  void main() {
    vec4 mvA = modelViewMatrix * vec4(aStart, 1.0);
    vec4 mvB = modelViewMatrix * vec4(aEnd, 1.0);
    vec4 clipA = projectionMatrix * mvA;
    vec4 clipB = projectionMatrix * mvB;
    vec2 sA = clipA.xy / clipA.w * uResolution * 0.5;
    vec2 sB = clipB.xy / clipB.w * uResolution * 0.5;
    vec2 dir = sB - sA;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);

    float t = position.x;
    float side = position.y;
    vec4 clip = mix(clipA, clipB, t);
    float depth = mix(-mvA.z, -mvB.z, t);
    float halfW = (uWidthPx * uPxScale) * 0.5 + 1.0;
    clip.xy += normal * side * halfW / uResolution * 2.0 * clip.w;
    gl_Position = clip;
    vSide = side * halfW / max(uWidthPx * uPxScale * 0.5, 0.5);

    float coc = cocPx(depth);
    float blurFade = 1.0 / (1.0 + pow(coc / (5.0 * uPxScale), 2.0));
    float screenT = clip.x / clip.w * 0.5 + 0.5;
    vec3 col = paletteAt(screenT, 0.0);
    float fog = fogAt(depth);
    vColor = col * aAlpha * uLineAlpha * blurFade * fog;
  }
`;

export const lineFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vSide;
  void main() {
    float a = 1.0 - smoothstep(0.6, 1.0 + 0.6, abs(vSide));
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const backdropFragment = /* glsl */ `
  uniform vec3 uBackground;
  uniform vec3 uGlow;
  uniform vec3 uColorL;
  uniform vec3 uColorR;
  uniform float uAspect;
  uniform float uHorizon;
  varying vec2 vUv;

  void main() {
    vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y);
    vec3 col = uBackground;
    // Soft overhead light spilling from the top centre.
    float g = exp(-(p.x * p.x) * 1.1 - pow(max(0.0, 1.08 - p.y), 2.0) * 4.5);
    col += uGlow * g * 0.24;
    col *= 0.45 + 0.55 * smoothstep(0.0, 0.55, vUv.y);
    // Very faint coloured atmosphere above the horizon on each side.
    float hz = exp(-pow((vUv.y - uHorizon) * 4.0, 2.0));
    col += uColorL * 0.008 * hz * smoothstep(0.6, 0.0, vUv.x);
    col += uColorR * 0.006 * hz * smoothstep(0.4, 1.0, vUv.x);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const finalVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const finalFragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uExposure;
  uniform float uAspect;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uSeed;
  uniform float uSaturation;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + uSeed);
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 linearToSrgb(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
    // Smooth highlight roll-off that keeps hues (luminance based) with mild desaturation of hot cores.
    float l = max(max(c.r, c.g), c.b);
    float mapped = 1.0 - exp(-l);
    c = l > 1e-5 ? c * (mapped / l) : c;
    c = mix(c, vec3(mapped), smoothstep(0.8, 1.0, mapped) * 0.15);

    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(lum), c, uSaturation), 0.0);

    vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
    float v = smoothstep(0.35, 1.25, length(q));
    c *= 1.0 - uVignette * v;

    vec3 s = linearToSrgb(c);
    float n = hash(gl_FragCoord.xy) - 0.5;
    s += n * (uGrain + 1.0 / 255.0);
    gl_FragColor = vec4(s, 1.0);
  }
`;
