# Backdrop Studio

Generate key-visual backgrounds with a procedurally generated industrial **point-cloud
wave landscape**, with one or more logos placed in the centre. Every render is
different (seeded), and any result can be reproduced from its seed.

Everything runs in the browser. Logos never leave the machine.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

1. **Logos** – drop or pick several SVG / PNG / JPG / WebP files. They are centred in a
   row, normalised by visual area (an icon and a wide wordmark get similar weight),
   with optional thin dividers. Reorder (‹ ›), rescale or remove each one.
2. **Colour scheme** – pick a preset or set custom left / right particle colours,
   background and top glow.
3. **Point cloud** – *New variation* rolls a new seed. Sliders control density, wave
   height, mesh lines, floating dust, depth of field, glow and brightness.
4. **Output** – choose a size (HD → 4K, social card, banner, square) and export PNG or JPEG.

The URL keeps `seed` and `palette`, so a link reproduces the same background,
e.g. `/?seed=9001&palette=amber`.

## Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Vite + TypeScript, no UI framework | Small, fast, one screen of controls |
| Rendering | three.js (WebGL2) with custom GLSL | Hundreds of thousands of particles in ~0.2 s, real depth of field and bloom |
| Composition | 2D canvas | Pixel-exact logo placement, PNG/JPEG export at full resolution |
| Unit tests | Vitest | Generator, layout and state logic |
| E2E tests | Playwright (Chromium, software WebGL via SwiftShader) | Runs the same on machines without a GPU and in CI |

## How the image is made

- `src/core/field.ts` – seeded generator. A jittered grid (randomly rotated) is displaced by
  3–4 seeded sine waves, fractal simplex noise and a swell; crests are soft-limited so they
  never reach the logo area, and a valley term lifts the sides to frame the centre.
  Mesh lines connect grid neighbours in noise-masked patches. Dust is concentrated in the
  upper corners and kept out of the logo band.
- `src/render/shaders.ts` – per-particle thin-lens depth of field: each point grows by its
  circle of confusion and turns into a soft bokeh disc in the foreground while staying
  crisp at the focus distance. Colour blends left → right across the frame. Lines are
  instanced screen-space quads so they stay resolution independent.
- `src/render/backgroundRenderer.ts` – HDR (half-float, 4× MSAA) render, additive blending,
  bloom, then a final pass with highlight roll-off, vignette, grain and dithering.
- `src/core/layout.ts` + `src/compose/compositor.ts` – logo layout and composition.

## Tests

```bash
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end (Playwright; builds and serves the app)
npm run test:all     # typecheck + unit + e2e
```

First time only: `npx playwright install chromium`.

`e2e/visual-quality.spec.ts` encodes the composition rules of the target look and checks
them across several seeds and colour schemes: logo area dark and clear, bright crisp wave
band, deep blacks in the foreground, dust in the upper corners, nothing blown out. Each run
writes the composited renders to `test-results/gallery/` for a human look.

The app exposes `window.__backdrop` (`idle()`, `stats()`, `layout()`, `store`) for automation.

## Dev tools

`tools/` has small scripts used while tuning the look:
`snap.mjs` (render a URL to PNG), `stats.mjs` (region colour statistics),
`crop.mjs` (crop/zoom an image), `make-png-fixture.mjs`, `patch.mjs`.
