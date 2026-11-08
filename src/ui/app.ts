import { BackgroundRenderer, type RenderStats } from '../render/backgroundRenderer';
import { compose } from '../compose/compositor';
import { PALETTES, getPalette } from '../core/palettes';
import { randomSeed } from '../core/rng';
import type { Layout } from '../core/layout';
import {
  OUTPUT_SIZES,
  RENDER_KEYS,
  Store,
  defaultSettings,
  outputSize,
  paletteColors,
  resetSettingsPatch,
  type AppState,
  type Colors,
} from '../state';
import { isAcceptedLogo, loadLogo } from './logos';

type Slider = {
  key: keyof AppState;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

const CLOUD_SLIDERS: Slider[] = [
  { key: 'density', label: 'Density', min: 0.4, max: 1.6, step: 0.05, format: pct },
  { key: 'waveHeight', label: 'Wave height', min: 0, max: 1.8, step: 0.05, format: pct },
  { key: 'mesh', label: 'Mesh lines', min: 0, max: 2, step: 0.05, format: pct },
  { key: 'dust', label: 'Floating dust', min: 0, max: 2, step: 0.05, format: pct },
  { key: 'blur', label: 'Depth of field', min: 0, max: 2, step: 0.05, format: pct },
  { key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.05, format: pct },
  { key: 'brightness', label: 'Brightness', min: 0.3, max: 2, step: 0.05, format: pct },
];

const LOGO_SLIDERS: Slider[] = [
  { key: 'logoSize', label: 'Logo size', min: 0.04, max: 0.3, step: 0.005, format: pct },
  { key: 'logoGap', label: 'Spacing', min: 0.01, max: 0.2, step: 0.005, format: pct },
  { key: 'logoY', label: 'Vertical position', min: 0.2, max: 0.65, step: 0.005, format: pct },
  { key: 'dividerOpacity', label: 'Divider opacity', min: 0, max: 1, step: 0.05, format: pct },
];

const COLOR_FIELDS: { key: keyof Colors; label: string }[] = [
  { key: 'left', label: 'Left particles' },
  { key: 'right', label: 'Right particles' },
  { key: 'background', label: 'Background' },
  { key: 'glow', label: 'Top glow' },
];

export type AppHandle = {
  store: Store;
  /** Resolves once the current render (if any) has completed. */
  idle(): Promise<void>;
  renderCount(): number;
  stats(): RenderStats | null;
  layout(): Layout | null;
};

export function mountApp(root: HTMLElement, store: Store): AppHandle {
  root.innerHTML = template();
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const preview = $<HTMLCanvasElement>('#preview');
  const statusEl = $<HTMLElement>('[data-testid="status"]');
  const stage = $<HTMLElement>('.stage');
  const renderer = new BackgroundRenderer();

  let renderCount = 0;
  let lastStats: RenderStats | null = null;
  let lastLayout: Layout | null = null;
  let pendingRender = false;
  let pendingCompose = false;
  let scheduled: number | null = null;
  let idleResolvers: (() => void)[] = [];

  // ---------- Rendering ----------
  const setStatus = (s: 'rendering' | 'ready' | 'error', text?: string) => {
    stage.dataset.status = s;
    preview.dataset.status = s;
    root.querySelectorAll<HTMLButtonElement>('[data-action="export"]').forEach((button) => {
      button.disabled = s !== 'ready';
    });
    statusEl.textContent = text ?? (s === 'rendering' ? 'Rendering…' : 'Ready');
  };

  const flush = () => {
    scheduled = null;
    const state = store.state;
    const size = outputSize(state);
    try {
      if (pendingRender) {
        lastStats = renderer.render({
          width: size.width,
          height: size.height,
          seed: state.seed,
          colors: state.colors,
          density: state.density,
          waveHeight: state.waveHeight,
          dust: state.dust,
          mesh: state.mesh,
          blur: state.blur,
          glow: state.glow,
          brightness: state.brightness,
        });
      }
      lastLayout = compose(preview, renderer.canvas, state, size.width, size.height);
      renderCount++;
      preview.dataset.renderCount = String(renderCount);
      preview.dataset.seed = String(state.seed);
      const native =
        lastStats && (lastStats.renderWidth !== size.width || lastStats.renderHeight !== size.height)
          ? ` (rendered at ${lastStats.renderWidth}×${lastStats.renderHeight})`
          : ' (native)';
      const info = lastStats
        ? `${size.width}×${size.height}${native} · ${(lastStats.points + lastStats.dust).toLocaleString('en-US')} particles · ${Math.round(lastStats.ms)} ms`
        : '';
      setStatus('ready', 'Ready');
      $<HTMLElement>('[data-testid="render-info"]').textContent = info;
    } catch (err) {
      console.error(err);
      setStatus('error', `Render failed: ${(err as Error).message}`);
    }
    pendingRender = false;
    pendingCompose = false;
    const r = idleResolvers;
    idleResolvers = [];
    r.forEach((fn) => fn());
  };

  const schedule = (full: boolean) => {
    pendingRender ||= full || preview.dataset.status === 'error';
    pendingCompose = true;
    setStatus('rendering');
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    // Two frames: let the status paint before the (synchronous) GPU work starts.
    scheduled = requestAnimationFrame(() => {
      scheduled = requestAnimationFrame(flush);
    });
  };

  store.subscribe((_s, changed) => {
    const full = RENDER_KEYS.some((k) => changed.has(k));
    schedule(full);
    syncControls();
  });

  // ---------- Controls ----------
  const sliderHost = (id: string, sliders: Slider[]) => {
    const host = $<HTMLElement>(id);
    host.innerHTML = sliders.map(sliderMarkup).join('');
    for (const s of sliders) {
      const input = host.querySelector(`input[data-key="${s.key}"]`) as HTMLInputElement;
      input.addEventListener('input', () => store.set({ [s.key]: Number(input.value) } as Partial<AppState>));
      input.addEventListener('dblclick', () => store.set({ [s.key]: Number(input.dataset.default) } as Partial<AppState>));
    }
  };
  sliderHost('#cloud-sliders', CLOUD_SLIDERS);
  sliderHost('#logo-sliders', LOGO_SLIDERS);

  // Palette swatches
  const swatches = $<HTMLElement>('#palettes');
  swatches.innerHTML = PALETTES.map(
    (p) => `<button type="button" class="swatch" data-palette="${p.id}" data-testid="palette-${p.id}" title="${p.name}"
      style="--l:${p.left};--r:${p.right};--bg:${p.background};--g:${p.glow}">
      <span class="swatch-chip"></span><span class="swatch-name">${p.name}</span></button>`,
  ).join('');
  swatches.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-palette]') as HTMLElement | null;
    const p = btn && getPalette(btn.dataset.palette!);
    if (p) store.set({ paletteId: p.id, colors: paletteColors(p) });
  });

  // Custom colours
  const colorHost = $<HTMLElement>('#colors');
  colorHost.innerHTML = COLOR_FIELDS.map(
    (c) => `<label class="color-field"><input type="color" data-color="${c.key}" data-testid="color-${c.key}" aria-label="${c.label}" /><span>${c.label}</span></label>`,
  ).join('');
  colorHost.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.color as keyof Colors;
      store.set({ paletteId: 'custom', colors: { ...store.state.colors, [key]: input.value } });
    });
  });

  // Seed
  const seedInput = $<HTMLInputElement>('[data-testid="seed"]');
  seedInput.addEventListener('change', () => {
    const v = Math.floor(Number(seedInput.value));
    if (Number.isFinite(v) && v > 0) store.set({ seed: v });
    else seedInput.value = String(store.state.seed);
  });
  root.querySelectorAll('[data-action="randomize"]').forEach((b) =>
    b.addEventListener('click', () => {
      let s = randomSeed();
      while (s === store.state.seed) s = randomSeed();
      store.set({ seed: s });
    }),
  );

  // Output
  const sizeSelect = $<HTMLSelectElement>('[data-testid="size"]');
  sizeSelect.innerHTML = OUTPUT_SIZES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  sizeSelect.addEventListener('change', () => store.set({ sizeId: sizeSelect.value }));
  const formatSelect = $<HTMLSelectElement>('[data-testid="format"]');
  formatSelect.addEventListener('change', () => store.set({ format: formatSelect.value as 'png' | 'jpeg' }));
  const dividerToggle = $<HTMLInputElement>('[data-testid="dividers"]');
  dividerToggle.addEventListener('change', () => store.set({ dividers: dividerToggle.checked }));

  // Reset: every setting back to its default; the seed and uploaded logos are kept.
  root.querySelectorAll('[data-action="reset"]').forEach((b) =>
    b.addEventListener('click', () => store.set(resetSettingsPatch(store.state))),
  );

  // Export
  root.querySelectorAll('[data-action="export"]').forEach((b) =>
    b.addEventListener('click', async () => {
      await handle.idle();
      if (preview.dataset.status !== 'ready') return;
      const s = store.state;
      const size = outputSize(s);
      const mime = s.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((res) => preview.toBlob(res, mime, 0.95));
      if (!blob || store.state !== s || preview.dataset.status !== 'ready') return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pointscape-${s.paletteId}-${s.seed}-${size.width}x${size.height}.${s.format === 'jpeg' ? 'jpg' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }),
  );

  // ---------- Logos ----------
  const fileInput = $<HTMLInputElement>('[data-testid="logo-input"]');
  const dropzone = $<HTMLElement>('.dropzone');
  const errorEl = $<HTMLElement>('[data-testid="logo-error"]');
  const addFiles = async (files: FileList | File[]) => {
    errorEl.textContent = '';
    const list = Array.from(files);
    const rejected = list.filter((f) => !isAcceptedLogo(f));
    const loaded = [];
    for (const f of list.filter(isAcceptedLogo)) {
      try {
        loaded.push(await loadLogo(f));
      } catch (e) {
        rejected.push(f);
        console.warn(e);
      }
    }
    if (rejected.length) errorEl.textContent = `Skipped: ${rejected.map((f) => f.name).join(', ')} (not a supported image)`;
    if (loaded.length) store.set({ logos: [...store.state.logos, ...loaded] });
  };
  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.length) await addFiles(fileInput.files);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
    if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
  });

  const logoList = $<HTMLElement>('[data-testid="logo-list"]');
  logoList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-logo-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-logo-id]')!.dataset.logoId!;
    const logos = [...store.state.logos];
    const i = logos.findIndex((l) => l.id === id);
    if (i < 0) return;
    const action = btn.dataset.logoAction;
    if (action === 'remove') {
      URL.revokeObjectURL(logos[i].url);
      logos.splice(i, 1);
    } else if (action === 'left' && i > 0) {
      [logos[i - 1], logos[i]] = [logos[i], logos[i - 1]];
    } else if (action === 'right' && i < logos.length - 1) {
      [logos[i + 1], logos[i]] = [logos[i], logos[i + 1]];
    } else return;
    store.set({ logos });
  });
  logoList.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.logoScale === undefined) return;
    const id = input.closest<HTMLElement>('[data-logo-id]')!.dataset.logoId!;
    store.set({
      logos: store.state.logos.map((l) => (l.id === id ? { ...l, scale: Number(input.value) } : l)),
    });
  });

  let renderedLogoIds = '';
  const renderLogoList = () => {
    const logos = store.state.logos;
    const ids = logos.map((l) => l.id).join('|');
    if (ids === renderedLogoIds) {
      // Same logos: only sync the per-logo scale sliders (e.g. after a reset).
      logoList.querySelectorAll<HTMLElement>('[data-logo-id]').forEach((li, i) => {
        const input = li.querySelector<HTMLInputElement>('[data-logo-scale]')!;
        if (Number(input.value) !== logos[i].scale) input.value = String(logos[i].scale);
      });
      return;
    }
    renderedLogoIds = ids;
    logoList.innerHTML = logos
      .map(
        (l, i) => `<li class="logo-item" data-logo-id="${l.id}" data-testid="logo-item">
        <div class="logo-thumb"><img src="${l.url}" alt="" /></div>
        <div class="logo-meta">
          <span class="logo-name" title="${escapeHtml(l.name)}">${escapeHtml(l.name)}</span>
          <input type="range" min="0.4" max="2" step="0.05" value="${l.scale}" data-logo-scale aria-label="Scale ${escapeHtml(l.name)}" data-testid="logo-scale" />
        </div>
        <div class="logo-actions">
          <button type="button" data-logo-action="left" aria-label="Move left" title="Move left" ${i === 0 ? 'disabled' : ''}>‹</button>
          <button type="button" data-logo-action="right" aria-label="Move right" title="Move right" ${i === logos.length - 1 ? 'disabled' : ''}>›</button>
          <button type="button" data-logo-action="remove" aria-label="Remove ${escapeHtml(l.name)}" title="Remove" data-testid="logo-remove">✕</button>
        </div>
      </li>`,
      )
      .join('');
    root.querySelector('.logo-empty')!.toggleAttribute('hidden', logos.length > 0);
  };

  // ---------- Sync UI with state ----------
  const syncControls = () => {
    const s = store.state;
    for (const sl of [...CLOUD_SLIDERS, ...LOGO_SLIDERS]) {
      const input = root.querySelector(`input[data-key="${sl.key}"]`) as HTMLInputElement;
      const v = s[sl.key] as number;
      if (Number(input.value) !== v) input.value = String(v);
      const out = root.querySelector(`output[data-for="${sl.key}"]`) as HTMLOutputElement;
      out.textContent = sl.format ? sl.format(v) : String(v);
    }
    if (document.activeElement !== seedInput) seedInput.value = String(s.seed);
    sizeSelect.value = s.sizeId;
    formatSelect.value = s.format;
    dividerToggle.checked = s.dividers;
    colorHost.querySelectorAll<HTMLInputElement>('input[type=color]').forEach((i) => {
      const v = s.colors[i.dataset.color as keyof Colors];
      if (i.value !== v) i.value = v;
    });
    swatches.querySelectorAll<HTMLElement>('[data-palette]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.palette === s.paletteId));
    });
    root.style.setProperty('--accent', s.colors.left);
    root.style.setProperty('--accent-2', s.colors.right);
    const size = outputSize(s);
    preview.style.aspectRatio = `${size.width} / ${size.height}`;
    renderLogoList();
    const url = new URL(location.href);
    url.searchParams.set('seed', String(s.seed));
    url.searchParams.set('size', s.sizeId);
    if (s.paletteId !== 'custom') url.searchParams.set('palette', s.paletteId);
    else url.searchParams.delete('palette');
    for (const { key } of COLOR_FIELDS) {
      if (s.paletteId === 'custom') url.searchParams.set(key, s.colors[key].slice(1));
      else url.searchParams.delete(key);
    }
    history.replaceState(null, '', url);
  };

  const handle: AppHandle = {
    store,
    idle: () =>
      scheduled === null && !pendingCompose && !pendingRender
        ? Promise.resolve()
        : new Promise<void>((res) => idleResolvers.push(res)),
    renderCount: () => renderCount,
    stats: () => lastStats,
    layout: () => lastLayout,
  };

  syncControls();
  schedule(true);
  return handle;
}

function sliderMarkup(s: Slider): string {
  return `<label class="slider">
    <span class="slider-label">${s.label}<output data-for="${s.key}"></output></span>
    <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" data-key="${s.key}" data-default="${defaultFor(s.key)}" data-testid="slider-${s.key}" aria-label="${s.label}" />
  </label>`;
}

function defaultFor(key: keyof AppState): number {
  const v = (defaultSettings() as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : 1;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function template(): string {
  return `
  <div class="app">
    <aside class="panel" aria-label="Settings">
      <header class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <h1>Pointscape Studio</h1>
          <p>Point-cloud key visuals</p>
        </div>
      </header>

      <section class="group">
        <h2>Logos</h2>
        <label class="dropzone" data-testid="dropzone">
          <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp,image/gif,.svg" multiple data-testid="logo-input" />
          <strong>Add logos</strong>
          <span>Drop files or click · SVG or transparent PNG works best</span>
        </label>
        <p class="error" data-testid="logo-error" role="alert"></p>
        <p class="logo-empty muted">No logos yet — the landscape renders on its own.</p>
        <ol class="logo-list" data-testid="logo-list"></ol>
        <div id="logo-sliders"></div>
        <label class="toggle"><input type="checkbox" data-testid="dividers" /> <span>Dividers between logos</span></label>
      </section>

      <section class="group">
        <h2>Colour scheme</h2>
        <div id="palettes" class="swatches"></div>
        <details class="custom-colors">
          <summary>Custom colours</summary>
          <div id="colors" class="color-grid"></div>
        </details>
      </section>

      <section class="group">
        <h2>Point cloud</h2>
        <div class="seed-row">
          <label class="seed-field"><span>Seed</span><input type="number" min="1" step="1" data-testid="seed" /></label>
          <button type="button" class="btn ghost" data-action="randomize" data-testid="randomize-panel">New variation</button>
        </div>
        <div id="cloud-sliders"></div>
        <p class="hint muted">Double-click a slider to reset it, or use <em>Reset settings</em> to reset everything.</p>
      </section>

      <section class="group">
        <h2>Output</h2>
        <label class="select"><span>Size</span><select data-testid="size"></select></label>
        <label class="select"><span>Format</span><select data-testid="format"><option value="png">PNG (lossless)</option><option value="jpeg">JPEG (smaller)</option></select></label>
      </section>
    </aside>

    <main class="stage" data-status="rendering">
      <div class="toolbar">
        <div class="status"><span class="dot"></span><span data-testid="status">Rendering…</span><span class="info" data-testid="render-info"></span></div>
        <div class="actions">
          <button type="button" class="btn ghost" data-action="reset" data-testid="reset" title="Reset all settings to their defaults. Keeps the current variation and your logos.">Reset settings</button>
          <button type="button" class="btn" data-action="randomize" data-testid="randomize">↻ New variation</button>
          <button type="button" class="btn primary" data-action="export" data-testid="export">Export image</button>
        </div>
      </div>
      <div class="canvas-wrap">
        <canvas id="preview" data-testid="preview" data-render-count="0"></canvas>
      </div>
    </main>
  </div>`;
}
