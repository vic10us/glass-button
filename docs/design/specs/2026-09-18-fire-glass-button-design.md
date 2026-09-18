# fire-glass-button: Design Spec

Date: 2026-09-18
Status: Approved for implementation

Visual target: `docs/brief/reference_image.png`.

## Purpose

A framework-agnostic `<fire-glass-button>` custom element that renders a
photorealistic, Apple-style thick translucent glass pill with procedural
GPU fire burning inside its lower third. The fire must visibly light the glass.
The result should read as a CGI product render first and as a UI control
second, while remaining a real, accessible `<button>` with sharp HTML text.

## Non-goals

- Not generic glassmorphism (`rgba` + `backdrop-filter`) and not a CSS
  keyframe flame. The primary visual is GPU-rendered.
- No Three.js, no WebGPU, no runtime dependencies. The visual is a 2D
  screen-space shading problem and a raw WebGL2 quad pipeline covers it.
- No framework wrapper packages. Documentation covers vanilla, React, Angular.
- The renderer does not sample the page behind the canvas. The glass body has
  its own dark tint and is composited with premultiplied alpha over whatever
  the page provides.

## Rendering architecture

### Why raw WebGL2

Every effect in the brief (curved glass edges, Fresnel, refraction, fire
lighting, bloom, floor glow) can be computed per pixel from a signed distance
field of a pill plus a small fire buffer. There is no mesh, no camera and no
scene graph, so Three.js would add weight and indirection without simplifying
anything. WebGL2 is universal in 2026 browsers, and WebGPU would still require
a WebGL fallback, so it buys nothing here.

### Passes

Every frame renders one full-screen triangle through three fragment programs:

1. **Fire pass** into `fireTex` (RGBA16F, low resolution). Texel density is
   fixed relative to the pill height (about 160 texels per pill height, width
   proportional, clamped), so the fire has the same detail at every button
   size and scales rather than stretches.
   - Coordinates are normalised to pill height, origin at the pill's bottom
     centre, so all flame shapes are size independent.
   - 3D simplex noise with time as the third axis, so the flame field evolves
     rather than only translating. FBM of 4-5 octaves, domain warped by a
     second lower-frequency FBM (turbulence).
   - Two flame layers with different scale, upward velocity and warp so no
     period is perceptible. Each layer's density is `fbm - heightFalloff`,
     shaped by a wide horizontal envelope that rises at the pill's rounded
     ends (the reference shows flames climbing the curved end walls).
   - Heat to colour ramp: deep red edge, orange body, yellow, white-hot core.
     HDR values above 1.0 at the core so tonemapping and bloom saturate to
     white naturally. Base is hotter; tips are thinner and more transparent.
   - Embers: sparse hash-grid points rising with noise drift, flickering.
   - Smoke: dim, low-alpha grey field above the flames.
   - Output premultiplied HDR colour, alpha = opacity.
2. **Bloom pass** into `bloomTex`: downsample `fireTex` to quarter resolution
   and apply a separable Gaussian blur (two programs, or one program run
   twice with a direction uniform). `bloomTex` is used both as the bloom
   contribution and as the fire's blurred *illuminance map* for lighting the
   glass and the floor.
3. **Composite pass** to the canvas at full device resolution.
   - Pill SDF in pill-height units. Antialiased edge via `fwidth`.
   - Cross-section normal: with `u = 1 + d/r` (0 at centre, 1 at the edge),
     surface height `z = k·sqrt(1 - u²)`; normal from its gradient. `k` is the
     glass thickness parameter and controls how wide and steep the curved
     edge zone is.
   - Fresnel (`F0 = 0.04`, Schlick), scaled by `reflectionStrength`.
   - Procedural studio environment: bright cool softbox above and in front,
     dark below, faint cyan/blue tint on grazing top reflections. The softbox
     centre follows the eased pointer position so highlights slide across
     the glass like a moving light.
   - Transmission: dark tinted body (`glassOpacity`) plus the fire sampled
     from `fireTex` at a refracted coordinate offset by `normal.xy ·
     refractionStrength`, with three slightly different offsets for R, G and
     B (chromatic aberration). Heat shimmer distorts the sampling coordinate
     with a small high-frequency noise field above the flames.
   - Fire lighting on the glass: `bloomTex` sampled at and below the pixel
     gives warm light that (a) tints the Fresnel rim, strongest at the lower
     edge and ends, (b) bleeds into the translucent body with a vertical
     falloff, and (c) adds a faint mirrored internal reflection near the
     upper inner surface.
   - Bloom added inside the pill and, attenuated, just outside it.
   - Floor: below the pill, mirror `bloomTex` about the pill's bottom edge
     with a steep vertical fade to produce the soft orange reflection and
     ambient glow beneath the button.
   - Linear-light shading, filmic tonemap, sRGB encode, premultiplied alpha.

### Interaction uniforms

`uHover`, `uPress` (0..1, eased in JS with frame-rate independent
exponential smoothing), `uPointer` (eased, pill-normalised). Hover raises
fire intensity and height, lower-glass illumination, bloom and rim
brightness. Press adds a short warm pulse. Physical compression is a CSS
transform on a wrapper containing both canvas and button (scale 0.985, ~120
ms in, ~350 ms out on an ease-out curve, no overshoot).

### Frame loop and performance

- One `requestAnimationFrame` loop per element; time from
  `performance.now()`, with a random per-instance offset so multiple buttons
  never flicker in sync.
- Loop pauses when the element is offscreen (`IntersectionObserver`) or the
  document is hidden.
- `prefers-reduced-motion: reduce` freezes fire time. Frames render only
  while an interaction state is easing, then stop. The design (glass, fire
  still, glow) remains intact.
- Device pixel ratio capped at 2. Fire buffer resolution is independent of
  the canvas resolution.
- Per-frame JS is a handful of lerps and uniform uploads; no DOM writes.

### Fallback

If `canvas.getContext('webgl2')` returns null (or context creation throws),
the element sets `data-renderer="css"` and the shadow stylesheet supplies a
simplified look: dark glass body, inset highlight, static orange gradient
along the bottom and a soft glow shadow. The button stays fully usable.
Context loss is handled by tearing down and reinitialising GL resources.

## DOM and CSS

```
<fire-glass-button>                 host: display:inline-block; position:relative
  #shadow-root
    <div class="frame">              press transform lives here
      <canvas aria-hidden="true">    absolute, inset: -pad; pointer-events:none
      <button part="button">         real button, above the canvas
        <span class="label"><slot></slot></span>
      </button>
```

- The canvas is oversized around the button so bloom and the floor glow can
  extend beyond the pill. Padding is a fraction of the button height.
- Button geometry: `border-radius: 999px`, padding in `em` so the pill scales
  with `font-size`; consumers may also set an explicit width/height on the
  host. Aspect is whatever the content and CSS produce; the shader receives
  the button rect in canvas pixels each resize.
- Text is slotted HTML on top of the canvas, so it stays perfectly sharp.
- Focus: `:focus-visible` draws a 2 px offset ring in a cool white, matching
  the glass highlight palette.
- CSS custom properties: `--fgb-text-color`, `--fgb-font`, `--fgb-padding`,
  `--fgb-focus-ring`.

## Public API

Attributes (kebab-case) and matching camelCase properties, all numeric and
clamped to a documented range, with defaults tuned against the reference:

| Parameter | Default | Effect |
|---|---|---|
| `fire-intensity` | 1.0 | overall fire brightness / density |
| `fire-height` | 1.0 | how far flames reach up the pill |
| `turbulence` | 1.0 | domain warp strength |
| `fire-speed` | 1.0 | time scale of the fire |
| `glass-opacity` | 0.82 | darkness of the glass body |
| `glass-thickness` | 1.0 | curvature/width of the edge zone |
| `refraction-strength` | 1.0 | fire distortion through the edge |
| `bloom-strength` | 1.0 | bloom and light leak |
| `reflection-strength` | 1.0 | Fresnel and environment reflection |
| `ember-density` | 1.0 | number of embers |
| `heat-distortion` | 1.0 | shimmer amplitude |

- `params` property: get/set a plain object of all parameters at once.
- `FireGlassButton.defaults`: the default parameter object (read-only copy).
- `renderer` read-only property: `"webgl2" | "css"`.
- `click`, `focus`, keyboard activation come from the native `<button>`.
- `disabled` attribute is mirrored onto the inner button.

## Accessibility

- Semantic `<button>` inside the shadow root; slotted content is its label.
- Enter/Space activation, `:focus-visible` ring, `disabled` support.
- Canvas is `aria-hidden`. White text over a near-black body meets contrast
  targets; the fire occupies the lower third, below the text baseline area.
- Reduced motion honoured as described above and re-evaluated when the media
  query changes.

## Package structure

```
fire-button/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  README.md
  src/
    fire-glass-button.ts   custom element: DOM, attributes, a11y, wiring
    params.ts              parameter table, defaults, parsing and clamping
    interaction.ts         pure easing/state helpers (hover, press, pointer)
    renderer.ts            WebGL2 pipeline: programs, FBOs, resize, render()
    gl.ts                  small GL helpers: compile, link, FBO, uniforms
    styles.ts              shadow stylesheet including CSS fallback
    shaders/
      quad.vert.ts  noise.glsl.ts  fire.frag.ts  blur.frag.ts  composite.frag.ts
  demo/index.html          states, sizes, reduced-motion, tuning panel, FPS
  tools/screenshot.mjs     headless Chromium capture used during visual tuning
  tests/                   vitest + jsdom: params, interaction, element/fallback
```

Build: tsup to `dist/fire-glass-button.js` (ESM + d.ts) and
`dist/fire-glass-button.global.js` (minified IIFE). Importing registers the
element, guarded against double definition.

## Testing

- Unit (vitest/jsdom): parameter parsing and clamping, attribute/property
  reflection, easing math, element structure, CSS fallback path (jsdom has no
  WebGL, so the fallback is exercised naturally), disabled mirroring,
  reduced-motion branch selection.
- Visual: headless Chromium (SwiftShader) screenshots of the demo at 700, 500,
  350 px and mobile width, in idle, hover and pressed states, compared by eye
  against the reference at each build stage. Shader compile errors fail loudly
  in the console and the screenshot tool reports them.

## Visual iteration stages

Following the brief: pill + basic glass; convincing glass; procedural fire;
fire lighting; refraction; bloom, embers, smoke; interaction; final tuning
against the reference. Each stage is screenshotted before moving on.
