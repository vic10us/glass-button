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
 * CSS fallback (no WebGL2): a simplified but on-brand look. Dark glass body,
 * cool top highlight, static warm glow along the bottom and beneath.
 */
:host([data-renderer="css"]) button {
  background:
    radial-gradient(120% 90% at 50% 130%, rgba(255, 110, 20, 0.85) 0%, rgba(255, 60, 10, 0.55) 22%, rgba(120, 20, 0, 0.25) 42%, rgba(0, 0, 0, 0) 60%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.03) 22%, rgba(8, 10, 14, 0.9) 45%, rgba(8, 10, 14, 0.9) 100%);
  box-shadow:
    inset 0 1px 0 rgba(220, 235, 255, 0.55),
    inset 0 0 0 1px rgba(160, 190, 230, 0.18),
    inset 0 -18px 30px -12px rgba(255, 120, 30, 0.55),
    0 22px 48px -14px rgba(255, 110, 30, 0.5);
}

:host([data-renderer="css"]) canvas {
  display: none;
}
`;
