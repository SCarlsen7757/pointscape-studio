# Pointscape Studio

Generate key-visual backgrounds with a procedurally generated industrial **point-cloud
wave landscape**, with one or more logos placed in the centre. Every render is
different (seeded), and any result can be reproduced from its seed.

Images are generated **natively in 4K**: the scene is always rendered at 3840 × 2160 (or the
same pixel budget for other aspect ratios) with particle detail tuned for 4K. Smaller output
sizes are supersampled down from that render, so every size has the same look and crisp detail.

Everything runs in the browser. Logos never leave the machine.

**Live:** https://scarlsen7757.github.io/pointscape-studio/

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

1. **Logos** – drop or pick several SVG / PNG / JPG / WebP files. They are centred in a
   row, normalised by visual area (an icon and a wide wordmark get similar weight),
   with optional thin dividers. Reorder (‹ ›), rescale or remove each one.
2. **Colour scheme** – pick one of 8 presets (including *Neon Tropic*, hot pink → turquoise) or set
   custom left / right particle colours, background and top glow. Colours blend across the frame
   in OKLCH, so two different hues stay vivid through the middle instead of fading to grey.
3. **Point cloud** – *New variation* rolls a new seed. Sliders control density, wave
   height, mesh lines, floating dust, depth of field, glow and brightness.
4. **Output** – choose a size (4K is the default; also QHD, Full HD, HD, social card, banner,
   square) and export PNG or JPEG.
5. **Reset settings** (toolbar) puts every setting back to its default. The current variation
   (seed) and your logos are kept.

The URL keeps `seed`, `palette` (or custom colours), and output `size`, so a link reproduces the same background,
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
- `src/render/backgroundRenderer.ts` – native-4K HDR (half-float) render, additive blending,
  bloom, then a final pass with highlight roll-off, vignette, grain and dithering. Points and lines
  are anti-aliased in their shaders, so no MSAA buffer is needed at 4K.
- `src/core/resolution.ts` – native 4K render size for every output size.
- `src/core/color.ts` – OKLCH gradient blending (mirrored in the shaders).
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

The app exposes `window.__app` (`idle()`, `stats()`, `layout()`, `store`) for automation.

## Deployment

`.github/workflows/deploy.yml` runs the typecheck, unit tests and Playwright e2e suite on every
push and pull request. Pushes to `main` are then built and published to GitHub Pages
(repository *Settings → Pages → Source: GitHub Actions*). The build uses a relative base path,
so the same output works under `/pointscape-studio/` and at a domain root. The e2e report and
render gallery are attached to each run as the `test-results` artifact.

## Dependency updates

`.github/dependabot.yml` checks npm dependencies and GitHub Actions every Monday at
09:00 Europe/Copenhagen. Updates to `three` and `@types/three` are grouped so their
versions can be reviewed together. Dependabot pull requests run the existing CI tests.
The configuration takes effect when it is merged into the repository's default branch.

## Dev tools

`tools/` has small scripts used while tuning the look:
`snap.mjs` (render a URL to PNG), `stats.mjs` (region colour statistics),
`crop.mjs` (crop/zoom an image), `make-png-fixture.mjs`, `patch.mjs`.
