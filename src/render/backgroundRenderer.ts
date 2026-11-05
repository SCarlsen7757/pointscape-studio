import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { generateField, Z_FAR, type Field, type PointCloud } from '../core/field';
import type { Palette } from '../core/palettes';
import { NATIVE_HEIGHT, nativeRenderSize } from '../core/resolution';
import { gradientEnds, mixOklch, oklchToLinear } from '../core/color';

export type SceneColors = Pick<Palette, 'left' | 'right' | 'background' | 'glow'>;
import {
  skyFragment,
  skyVertex,
  finalFragment,
  finalVertex,
  lineFragment,
  lineVertex,
  pointFragment,
  pointVertex,
} from './shaders';

export type RenderSettings = {
  width: number;
  height: number;
  seed: number;
  colors: SceneColors;
  density: number;
  waveHeight: number;
  dust: number;
  mesh: number;
  /** Depth-of-field strength multiplier (0 – 2). */
  blur: number;
  /** Bloom / glow multiplier (0 – 2). */
  glow: number;
  /** Overall particle brightness multiplier (0.3 – 2). */
  brightness: number;
};

export type RenderStats = {
  /** Resolution the scene was actually rendered at (before downsampling). */
  renderWidth: number;
  renderHeight: number;
  points: number;
  dust: number;
  lines: number;
  ms: number;
};

const DEG = Math.PI / 180;

/** Renders the point-cloud scene with WebGL into its own (off-DOM) canvas. */
export class BackgroundRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private fieldKey = '';
  private field: Field | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  private objects: THREE.Object3D[] = [];
  private sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);

    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uBackground: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uColorL: { value: new THREE.Color() },
          uColorR: { value: new THREE.Color() },
          uAspect: { value: 16 / 9 },
          uHorizon: { value: 0.35 },
        },
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
  }

  get maxSize(): number {
    return this.renderer.capabilities.maxTextureSize;
  }

  render(s: RenderSettings): RenderStats {
    const t0 = performance.now();
    const aspect = s.width / s.height;
    const { width: rw, height: rh } = nativeRenderSize(s.width, s.height);
    const key = JSON.stringify([s.seed, aspect.toFixed(4), s.density, s.waveHeight, s.dust, s.mesh]);
    if (key !== this.fieldKey || !this.field) {
      this.field = generateField({
        seed: s.seed,
        aspect,
        density: s.density,
        waveHeight: s.waveHeight,
        dust: s.dust,
        mesh: s.mesh,
      });
      this.fieldKey = key;
      this.rebuildScene(this.field);
    }
    const field = this.field;

    // Camera
    const cam = field.camera;
    this.camera.fov = cam.fovY;
    this.camera.aspect = aspect;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.position.set(0, cam.height, 0);
    this.camera.rotation.set(cam.pitch * DEG, cam.yaw * DEG, 0, 'YXZ');
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const pxScale = rh / NATIVE_HEIGHT;
    const focalPx = (rh / 2) / Math.tan((cam.fovY * DEG) / 2);
    const colL = new THREE.Color(s.colors.left);
    const colR = new THREE.Color(s.colors.right);
    const [lchL, lchR] = gradientEnds([colL.r, colL.g, colL.b], [colR.r, colR.g, colR.b]);
    const hazeRgb = oklchToLinear(mixOklch(lchL, lchR, 0.5));
    const haze = new THREE.Color().setRGB(hazeRgb[0], hazeRgb[1], hazeRgb[2]).multiplyScalar(0.35);
    const shared = {
      uPxScale: pxScale,
      uFocalPx: focalPx,
      uFocus: cam.focus,
      uAperture: 0.13 * s.blur,
      uFarBlur: 0.3,
      uFogNear: Z_FAR * 0.25,
      uFogFar: Z_FAR * 0.95,
      uLchL: new THREE.Vector3(...lchL),
      uLchR: new THREE.Vector3(...lchR),
      uHaze: haze,
    };
    for (const obj of this.objects) {
      const mat = (obj as THREE.Mesh).material as THREE.ShaderMaterial;
      for (const [k, v] of Object.entries(shared)) {
        if (mat.uniforms[k]) mat.uniforms[k].value = v;
      }
      if (mat.uniforms.uResolution) mat.uniforms.uResolution.value.set(rw, rh);
      if (mat.uniforms.uIntensity) {
        const isDust = obj.name === 'dust';
        mat.uniforms.uIntensity.value = (isDust ? 0.75 : 1.5) * s.brightness;
      }
    }

    const bu = this.sky.material.uniforms;
    bu.uBackground.value.set(s.colors.background);
    bu.uGlow.value.set(s.colors.glow);
    bu.uColorL.value.copy(colL);
    bu.uColorR.value.copy(colR);
    bu.uAspect.value = aspect;

    // Post-processing chain (rebuilt per render; cheap relative to a still render).
    // No MSAA: points and lines are anti-aliased in their shaders, and a 4K multisampled
    // half-float target would cost ~260 MB of GPU memory.
    this.renderer.setSize(rw, rh, false);
    const target = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(rw, rh);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(rw, rh), 0.2 * s.glow, 0.45, 0.3);
    if (s.glow > 0) composer.addPass(bloom);
    const final = new ShaderPass(
      new THREE.ShaderMaterial({
        vertexShader: finalVertex,
        fragmentShader: finalFragment,
        uniforms: {
          tDiffuse: { value: null },
          uExposure: { value: 1.25 },
          uAspect: { value: aspect },
          uVignette: { value: 0.72 },
          uGrain: { value: 0.012 },
          uSaturation: { value: 1.25 },
          uSeed: { value: (s.seed % 997) / 997 },
        },
      }),
    );
    composer.addPass(final);
    composer.render();

    composer.dispose();
    bloom.dispose();
    final.material.dispose();
    target.dispose();

    return {
      renderWidth: rw,
      renderHeight: rh,
      points: field.terrain.count,
      dust: field.dust.count,
      lines: field.lines.count,
      ms: performance.now() - t0,
    };
  }

  private rebuildScene(field: Field): void {
    for (const obj of this.objects) {
      this.scene.remove(obj);
      const m = obj as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.objects = [];
    this.scene.add(this.sky);

    const lines = this.buildLines(field);
    if (lines) this.objects.push(lines);
    const terrain = this.buildPoints(field.terrain, 'terrain', { sizeWorld: 0.018, minPx: 3.2, maxPx: 140, bokehGain: 0.3 });
    const dust = this.buildPoints(field.dust, 'dust', { sizeWorld: 0.011, minPx: 1.8, maxPx: 160, bokehGain: 0.09 });
    this.objects.push(terrain, dust);
    for (const o of this.objects) this.scene.add(o);
  }

  private dofUniforms(): Record<string, THREE.IUniform> {
    return {
      uPxScale: { value: 1 },
      uFocalPx: { value: 1000 },
      uFocus: { value: 15 },
      uAperture: { value: 0.05 },
      uFarBlur: { value: 0.3 },
      uFogNear: { value: 25 },
      uFogFar: { value: 60 },
      uLchL: { value: new THREE.Vector3() },
      uLchR: { value: new THREE.Vector3() },
      uHaze: { value: new THREE.Color() },
    };
  }

  private buildPoints(
    cloud: PointCloud,
    name: string,
    o: { sizeWorld: number; minPx: number; maxPx: number; bokehGain: number },
  ): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(cloud.sizes, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(cloud.brightness, 1));
    g.setAttribute('aHue', new THREE.BufferAttribute(cloud.hueJitter, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: {
        ...this.dofUniforms(),
        uSizeWorld: { value: o.sizeWorld },
        uMinPx: { value: o.minPx },
        uMaxPx: { value: o.maxPx },
        uIntensity: { value: 1 },
        uBokehGain: { value: o.bokehGain },
      },
    });
    const pts = new THREE.Points(g, mat);
    pts.name = name;
    pts.frustumCulled = false;
    return pts;
  }

  private buildLines(field: Field): THREE.Mesh | null {
    const ls = field.lines;
    if (ls.count === 0) return null;
    const g = new THREE.InstancedBufferGeometry();
    // Quad: x = t along the segment, y = side.
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(ls.starts, 3));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(ls.ends, 3));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(ls.alphas, 1));
    g.instanceCount = ls.count;
    const mat = new THREE.ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: {
        ...this.dofUniforms(),
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uWidthPx: { value: 1.3 },
        uLineAlpha: { value: 0.11 },
      },
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'lines';
    mesh.frustumCulled = false;
    return mesh;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
