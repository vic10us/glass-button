# fire-glass-button

A framework-agnostic `<fire-glass-button>` custom element: a thick, dark,
translucent glass pill with procedural fire burning inside its lower third,
rendered in real time with WebGL2. The fire lights the glass (warm lower rim,
light bleeding into the body, refraction through the curved edges), throws a
soft reflection on the floor beneath, and responds to hover, pointer position
and press. Underneath it is a plain `<button>` with slotted HTML text, so it
stays sharp, focusable and accessible.

Zero runtime dependencies. Ships as ESM and as a plain `<script>` IIFE.

## Install

```bash
npm install fire-glass-button
```

## Usage

### Vanilla HTML/JS

```html
<script type="module" src="node_modules/fire-glass-button/dist/fire-glass-button.js"></script>

<fire-glass-button>Take Action →</fire-glass-button>

<script type="module">
  const el = document.querySelector('fire-glass-button');
  el.addEventListener('click', () => console.log('clicked'));
  el.fireHeight = 1.2;                 // property, reflected to fire-height="1.2"
  el.params = { bloomStrength: 0.8 };  // merge several parameters at once
</script>
```

Or via the global build:

```html
<script src="node_modules/fire-glass-button/dist/fire-glass-button.global.js"></script>
<fire-glass-button>Take Action →</fire-glass-button>
```

Size it with `font-size` (padding is in `em`), or give the host an explicit
`width`/`height`; the inner button fills the host. The canvas that draws the
glow extends beyond the pill, like a drop shadow, so leave room below it.

### React

```jsx
import 'fire-glass-button';

export function Cta() {
  return <fire-glass-button fire-height="1.1" onClick={go}>Take Action →</fire-glass-button>;
}
```

### Angular

Add `CUSTOM_ELEMENTS_SCHEMA` to the consuming module, then:

```html
<fire-glass-button [attr.fire-intensity]="intensity" (click)="go()">Take Action →</fire-glass-button>
```

## Status modes

`status="healthy" | "warning" | "trouble" | "unknown"` recolours the fire,
the glass rim and the floor glow, shows a matching line icon (check circle,
warning triangle, cross circle, question circle) and applies a few preset
parameter nudges (Unknown burns lower and sparklier, like plasma). Without
a status the button keeps the default orange fire and shows no icon.
Changing the status crossfades the palette over about half a second.

```html
<fire-glass-button status="healthy">Healthy</fire-glass-button>
<fire-glass-button status="trouble" icon="none">Trouble</fire-glass-button>
<fire-glass-button status="warning">
  <svg slot="icon" viewBox="0 0 24 24">…</svg>
  Warning
</fire-glass-button>
```

- `status` property mirrors the attribute; `null` clears it. Invalid values
  are ignored.
- `statuschange`: `CustomEvent<{ oldStatus, newStatus }>` after a change.
- `icon="none"` hides the built-in icon; an element with `slot="icon"`
  replaces it. `::part(icon)` styles the icon wrapper, and
  `--fgb-icon-color` is set from the palette (override it if you like).
- A visually hidden "Status: healthy" span inside the button announces the
  state to assistive technology whatever the visible label says.
- `palette` property: supply `{ fire: [edge, low, mid, hot, core], rim, icon }`
  with linear-light RGB triples (HDR values above 1 are fine) and a CSS icon
  colour to override the status palette; set `null` to clear. The presets
  are exported as `STATUS_PRESETS` and `DEFAULT_PALETTE`.

## API

### Parameters

Every parameter is a number available as a kebab-case attribute and a
camelCase property. Values outside the range are clamped; unparseable values
fall back to the default. Effective values layer defaults, then the status
preset, then explicit attributes; removing an attribute reveals the layer
below.

| Attribute | Property | Default | Range | Effect |
|---|---|---|---|---|
| `fire-intensity` | `fireIntensity` | 1.0 | 0–3 | Fire brightness and density |
| `fire-height` | `fireHeight` | 1.0 | 0–2.5 | How far flames reach up the pill |
| `turbulence` | `turbulence` | 1.0 | 0–3 | Domain-warp strength, the curl of the tongues |
| `fire-speed` | `fireSpeed` | 1.0 | 0–4 | Time scale of the fire |
| `glass-opacity` | `glassOpacity` | 0.82 | 0–1 | Darkness of the glass body over the page |
| `glass-thickness` | `glassThickness` | 1.0 | 0.2–3 | Curvature and width of the rounded edge zone |
| `refraction-strength` | `refractionStrength` | 1.0 | 0–3 | Fire distortion through the curved edge |
| `bloom-strength` | `bloomStrength` | 1.0 | 0–3 | Bloom, light leak and floor glow |
| `reflection-strength` | `reflectionStrength` | 1.0 | 0–3 | Fresnel and environment reflection |
| `ember-density` | `emberDensity` | 1.0 | 0–4 | Number of rising embers |
| `heat-distortion` | `heatDistortion` | 1.0 | 0–3 | Heat shimmer amplitude |

- `params` (get/set): all parameters as a plain object; setting merges keys.
- `FireGlassButton.defaults`: a copy of the default parameter set.
- `renderer` (read-only): `"webgl2"` or `"css"`.
- `reducedMotion`: `'auto'` (default, follows `prefers-reduced-motion`),
  `true` or `false`.
- `disabled`: reflected to the inner button.
- `focus()`: focuses the inner button.

### Events

`click`, `focus`, `blur` and keyboard activation come from the native
`<button>`; listen on the element as you would on a button.

### CSS custom properties

| Property | Default |
|---|---|
| `--fgb-text-color` | `#f4f7ff` |
| `--fgb-font` | system sans-serif stack |
| `--fgb-padding` | `0.95em 2.4em` |
| `--fgb-focus-ring` | `rgba(200, 225, 255, 0.9)` |

`::part(button)` exposes the inner button for further styling.

## Behaviour

- **Hover** raises fire height and intensity, lower-glass illumination, bloom
  and rim brightness, eased over a few hundred milliseconds. The pointer
  position slides the key light across the glass.
- **Press** compresses the pill slightly (CSS transform, ease-out, no
  bounce), intensifies the fire and adds a brief warm pulse on click.
- **Reduced motion**: fire time is frozen and frames render only while a
  state is easing. The still design (glass, fire, glow) remains.
- **Offscreen or hidden tab**: the frame loop pauses.
- **No WebGL2**: the host gets `data-renderer="css"` and a simplified CSS
  glass with a static warm glow. Setting that attribute yourself forces the
  fallback, which is handy for testing.

## Rendering

Three fragment passes on one full-screen triangle, all in units of pill
height so the look is identical at any size:

1. **Fire** into a low-resolution HDR buffer (about 160 texels per pill
   height). Two domain-warped 3D simplex FBM layers advected upward, with
   time as the third noise axis so the field evolves rather than scrolls; a
   height cost that thins the tips; a temperature-to-colour ramp from deep
   red through orange and yellow to a white-hot HDR core; faint smoke.
2. **Blur** at half that resolution, run twice. Used as bloom and as the
   fire's illuminance map for lighting the glass and the floor.
3. **Composite** at device resolution: pill signed-distance field, a
   filleted cross-section normal, Schlick Fresnel, a procedural studio
   environment (cool strip softbox above and behind, blue side lights, dark
   backdrop), refraction with chromatic aberration, heat shimmer, embers,
   warm edge light from the fire, mirrored floor reflection, ACES tonemap.

Shader sources are in `src/shaders/` and are commented for modification.

## Performance notes

- Each element owns one WebGL2 context. Browsers cap the number of live
  contexts (usually 16), so use a handful per page, not dozens.
- Per-frame JavaScript is a few lerps and uniform uploads; no DOM writes.
- Device pixel ratio is capped at 2. The fire buffer resolution does not
  depend on DPR.

## Development

```bash
npm install
npm test          # vitest + jsdom
npm run build     # tsup -> dist/
npm run shot -- all   # headless Chromium screenshots of demo scenes -> shots/
npm run shot -- backgrounds        # the status row on every preset page background
npm run shot -- idle --bg=white    # any scene on a preset key or #hex background
npm run shot -- page --bg=paper    # full demo page
```

The demo has a background switcher (bottom left) with dark, light, gradient,
mesh and paper presets plus a custom colour, so you can judge the glass and
glow against the pages it will live on. The choice persists and is
addressable as `?bg=<key|#hex>`.

`demo/index.html` (serve the package directory, e.g. `npx serve .`) shows
the four status modes, idle, hover, pressed, sizes, mobile width, reduced
motion and the CSS fallback, with a tuning panel for every parameter and an
FPS readout.
