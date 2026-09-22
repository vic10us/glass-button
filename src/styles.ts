/**
 * Shadow stylesheet.
 *
 * The GL canvas paints the glass and fire; CSS only handles layout, the real
 * button, the press compression, focus and the no-WebGL fallback. Sizes use
 * `em` so the whole pill scales with `font-size`, while an explicit
 * width/height on the host also works because the button fills the host.
 */
export const STYLES = /* css */ `
:host {
  display: inline-block;
  position: relative;
  vertical-align: middle;
  font: 600 1rem/1 var(--gb-font, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif);
  color: var(--gb-text-color, #f4f7ff);
  /* The canvas overflows the host (glow beneath the pill), like a drop shadow would. */
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}

:host([hidden]) { display: none; }

.frame {
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: 50% 55%;
  /* Release: an ease-out with no overshoot, so it reads as solid material relaxing. */
  transition: transform 350ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

:host([data-pressed]) .frame {
  transform: scale(0.985);
  transition-duration: 120ms;
}

canvas {
  position: absolute;
  display: block;
  pointer-events: none;
  z-index: 0;
  /* JS positions and sizes the canvas from the measured pill height. */
  left: 0;
  top: 0;
}

button {
  position: relative;
  z-index: 1;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: var(--gb-padding, 0.95em 2.4em);
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: 0.015em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  outline: none;
}

button:focus-visible {
  outline: 2px solid var(--gb-focus-ring, rgba(200, 225, 255, 0.9));
  outline-offset: 5px;
}

button:disabled {
  cursor: default;
}

:host([disabled]) {
  opacity: 0.6;
}

.label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  width: 100%;
  font-size: 0.94em;
}

/*
 * Engraved label: the GL layer renders the lettering as part of the glass,
 * so the DOM text turns transparent. It stays in the tree for assistive
 * technology, find-in-page and selection. A built-in icon that was engraved
 * hides the same way; a consumer's slot="icon" element stays visible.
 */
:host([data-etched]) .label {
  color: transparent;
}

:host([data-etched]) .icon.engraved {
  opacity: 0;
}

/* Built-in status icon: a line icon in the status colour with a soft glow. */
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.05em;
  height: 1.05em;
  margin-right: 0.15em;
  color: var(--gb-icon-color, currentColor);
  filter: drop-shadow(0 0 0.18em color-mix(in srgb, var(--gb-icon-color, currentColor) 70%, transparent));
  transition: color 500ms ease;
  flex: none;
}

.icon[hidden] {
  display: none;
}

.icon svg,
.icon ::slotted(*) {
  width: 100%;
  height: 100%;
  display: block;
}

/* Visually hidden status text for assistive tech. */
.sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/*
 * CSS fallback (no WebGL2): a simplified look built from the same palette
 * variables the GL path publishes (--gb-fx-*), so it follows status, effect
 * and hover. The element registers those properties (CSS.registerProperty)
 * so they crossfade on change.
 * Layers: the glass body with a cool top sheen (button background), the
 * effect (::before), the rim and floor glow (box shadows).
 */

:host([data-renderer="css"]) {
  transition: --gb-fx-deep 600ms ease, --gb-fx-mid 600ms ease, --gb-fx-light 600ms ease,
    --gb-fx-bright 600ms ease, --gb-fx-hi 600ms ease, --gb-fx-rim 600ms ease;
}

:host([data-renderer="css"]) canvas {
  display: none;
}

:host([data-renderer="css"]) button {
  overflow: hidden;
  isolation: isolate;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.04) 16%, rgba(0, 0, 0, 0) 34%),
    rgba(12, 14, 19, 0.88);
  box-shadow:
    /* cool top rim and a status-tinted lower rim, like the GL Fresnel */
    inset 0 1px 0 rgba(225, 238, 255, 0.55),
    inset 0 0 0 1px color-mix(in srgb, var(--gb-fx-rim) 30%, rgba(170, 195, 230, 0.15)),
    inset 0 -2px 0 color-mix(in srgb, var(--gb-fx-rim) 70%, transparent),
    inset 0 -14px 26px -10px color-mix(in srgb, var(--gb-fx-mid) 65%, transparent),
    /* floor glow beneath */
    0 18px 40px -12px color-mix(in srgb, var(--gb-fx-mid) 60%, transparent),
    0 4px 14px -6px color-mix(in srgb, var(--gb-fx-light) 45%, transparent);
  transition: box-shadow 500ms ease;
}

/* Fire: a bank of soft tongues along the bottom, brightest at the base. */
:host([data-renderer="css"]) button::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(38% 46% at 14% 104%, var(--gb-fx-bright) 0%, color-mix(in srgb, var(--gb-fx-light) 70%, transparent) 30%, transparent 62%),
    radial-gradient(30% 56% at 36% 106%, var(--gb-fx-hi) 0%, var(--gb-fx-light) 28%, color-mix(in srgb, var(--gb-fx-mid) 60%, transparent) 50%, transparent 70%),
    radial-gradient(34% 44% at 58% 104%, var(--gb-fx-bright) 0%, color-mix(in srgb, var(--gb-fx-light) 70%, transparent) 32%, transparent 64%),
    radial-gradient(30% 58% at 80% 106%, var(--gb-fx-hi) 0%, var(--gb-fx-light) 26%, color-mix(in srgb, var(--gb-fx-mid) 55%, transparent) 50%, transparent 72%),
    radial-gradient(70% 34% at 50% 104%, var(--gb-fx-mid) 0%, color-mix(in srgb, var(--gb-fx-deep) 80%, transparent) 55%, transparent 100%);
  opacity: 0.92;
  transition: opacity 400ms ease, transform 400ms ease;
  transform-origin: 50% 100%;
}

/* Water: a level pool with a bright surface line and a deep floor. */
:host([data-renderer="css"][effect="water"]) button::before {
  background:
    linear-gradient(180deg,
      transparent 0%, transparent 69%,
      var(--gb-fx-hi) 69.5%, var(--gb-fx-bright) 71%,
      color-mix(in srgb, var(--gb-fx-light) 85%, transparent) 76%,
      var(--gb-fx-mid) 88%, var(--gb-fx-deep) 100%),
    radial-gradient(60% 24% at 30% 80%, color-mix(in srgb, var(--gb-fx-bright) 45%, transparent) 0%, transparent 60%),
    radial-gradient(50% 24% at 72% 84%, color-mix(in srgb, var(--gb-fx-bright) 40%, transparent) 0%, transparent 60%);
}

/* Hover and press: the effect rises and brightens, as in the GL path. */
:host([data-renderer="css"]) button:hover::before,
:host([data-renderer="css"][data-pressed]) button::before {
  opacity: 1;
  transform: scaleY(1.12);
}

:host([data-renderer="css"]) button:hover {
  box-shadow:
    inset 0 1px 0 rgba(225, 238, 255, 0.65),
    inset 0 0 0 1px color-mix(in srgb, var(--gb-fx-rim) 40%, rgba(170, 195, 230, 0.15)),
    inset 0 -2px 0 color-mix(in srgb, var(--gb-fx-rim) 85%, transparent),
    inset 0 -18px 30px -10px color-mix(in srgb, var(--gb-fx-mid) 80%, transparent),
    0 22px 48px -12px color-mix(in srgb, var(--gb-fx-mid) 75%, transparent),
    0 4px 14px -6px color-mix(in srgb, var(--gb-fx-light) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  :host([data-renderer="css"]),
  :host([data-renderer="css"]) button,
  :host([data-renderer="css"]) button::before {
    transition: none;
  }
}
`;
