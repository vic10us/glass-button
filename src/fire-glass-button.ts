/**
 * <fire-glass-button>
 *
 * A real <button> with slotted HTML text, sitting on top of a transparent,
 * oversized WebGL2 canvas that renders the glass pill, the fire inside it and
 * the glow beneath it. This file owns the DOM, attribute/property plumbing,
 * accessibility and the frame loop; all shading lives in the renderer.
 */
import { InteractionState, expSmooth } from './interaction';
import { PARAM_ATTRS, PARAM_DEFS, type Params, attrToParam, defaults, parseParam } from './params';
import { type Layout, Renderer } from './renderer';
import {
  DEFAULT_PALETTE,
  ICONS,
  type Palette,
  STATUS_PRESETS,
  type StatusName,
  flattenPalette,
  isStatus,
} from './status';
import { STYLES } from './styles';

export type { Params, ParamName } from './params';
export type { Palette, StatusName, RGB } from './status';
export { STATUS_NAMES, STATUS_PRESETS, DEFAULT_PALETTE } from './status';

export interface StatusChangeDetail {
  oldStatus: StatusName | null;
  newStatus: StatusName | null;
}

/** Canvas padding around the pill, as multiples of the pill height (room for glow). */
const PAD_X = 0.9;
const PAD_TOP = 0.9;
const PAD_BOTTOM = 1.7;
const MAX_DPR = 2;
const MAX_DT = 0.1;
/** Palette crossfade rate (1/s) when the status changes. */
const PALETTE_RATE = 5;

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `<style>${STYLES}</style>
<div class="frame">
  <canvas aria-hidden="true"></canvas>
  <button part="button" type="button">
    <span class="label"><span class="icon" part="icon" hidden><slot name="icon"></slot></span><slot></slot></span>
    <span class="sr-status"></span>
  </button>
</div>`;

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FireGlassButton extends Params {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class FireGlassButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...PARAM_ATTRS, 'disabled', 'status', 'icon'];
  }

  /** A copy of the default parameter set. */
  static get defaults(): Params {
    return defaults();
  }

  // One accessor pair per parameter: reading returns the parsed value, writing
  // reflects to the attribute so attributeChangedCallback stays the single path.
  static {
    for (const def of PARAM_DEFS) {
      Object.defineProperty(FireGlassButton.prototype, def.name, {
        configurable: true,
        enumerable: true,
        get(this: FireGlassButton): number {
          return this.#effective[def.name];
        },
        set(this: FireGlassButton, v: number) {
          this.setAttribute(def.attr, String(parseParam(def, v)));
        },
      });
    }
  }

  /** Parameters set explicitly through attributes. */
  #explicit: Partial<Params> = {};
  /** Effective parameters: defaults, then status preset, then explicit. */
  #effective: Params = defaults();
  #status: StatusName | null = null;
  #customPalette: Palette | null = null;
  /** Palette uploaded to the GPU (eased) and the one it is easing toward. */
  readonly #palette = flattenPalette(DEFAULT_PALETTE);
  readonly #paletteTarget = flattenPalette(DEFAULT_PALETTE);
  #paletteSettled = true;
  #hasRendered = false;
  readonly #frame: HTMLDivElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #button: HTMLButtonElement;
  readonly #icon: HTMLSpanElement;
  readonly #srStatus: HTMLSpanElement;
  readonly #interaction = new InteractionState();

  #renderer: Renderer | null = null;
  #rendererTried = false;
  #raf = 0;
  #lastNow = 0;
  #fireTime = Math.random() * 1000; // per-instance offset: several buttons never flicker in sync
  #needsFrame = true;
  #visible = true;
  #pointerRect: DOMRect | null = null;
  #keyPressed = false;

  #reducedOverride: 'auto' | boolean = 'auto';
  #motionQuery: MediaQueryList | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #intersectionObserver: IntersectionObserver | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(TEMPLATE.content.cloneNode(true));
    this.#frame = root.querySelector('.frame')!;
    this.#canvas = root.querySelector('canvas')!;
    this.#button = root.querySelector('button')!;
    this.#icon = root.querySelector('.icon')!;
    this.#srStatus = root.querySelector('.sr-status')!;
    this.#bindEvents();
  }

  // ---------------------------------------------------------------- public API

  /** All effective parameters as a plain object. Setting merges the given keys. */
  get params(): Params {
    return { ...this.#effective };
  }

  set params(patch: Partial<Params>) {
    for (const def of PARAM_DEFS) {
      const v = patch[def.name];
      if (v !== undefined) this[def.name] = v;
    }
  }

  /**
   * Status mode: recolours the fire, rim and floor glow, shows the matching
   * icon and applies the preset's parameter nudges. null is the default look.
   */
  get status(): StatusName | null {
    return this.#status;
  }

  set status(v: StatusName | null) {
    if (v === null || v === undefined) this.removeAttribute('status');
    else this.setAttribute('status', v);
  }

  /** Custom palette overriding the status palette; null to clear. */
  get palette(): Palette | null {
    return this.#customPalette;
  }

  set palette(p: Palette | null) {
    this.#customPalette = p;
    this.#applyStatus();
  }

  /** Which renderer is active. */
  get renderer(): 'webgl2' | 'css' {
    return this.#renderer ? 'webgl2' : 'css';
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  set disabled(v: boolean) {
    this.toggleAttribute('disabled', Boolean(v));
  }

  /**
   * Reduced-motion behaviour. 'auto' follows `prefers-reduced-motion`;
   * true/false force it (the demo uses this to show both behaviours).
   */
  get reducedMotion(): 'auto' | boolean {
    return this.#reducedOverride;
  }

  set reducedMotion(v: 'auto' | boolean) {
    this.#reducedOverride = v;
    this.#applyMotionPreference();
  }

  /** Focus the inner button. */
  focus(options?: FocusOptions): void {
    this.#button.focus(options);
  }

  // ------------------------------------------------------------------ lifecycle

  connectedCallback(): void {
    if (!this.hasAttribute('data-renderer')) this.#attachRenderer();
    this.#button.disabled = this.disabled;

    if (typeof ResizeObserver !== 'undefined' && !this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => this.#relayout());
      this.#resizeObserver.observe(this);
    }
    if (typeof IntersectionObserver !== 'undefined' && !this.#intersectionObserver) {
      this.#intersectionObserver = new IntersectionObserver((entries) => {
        this.#visible = entries.some((e) => e.isIntersecting);
        if (this.#visible) this.#wake();
      });
      this.#intersectionObserver.observe(this);
    }
    if (typeof matchMedia === 'function' && !this.#motionQuery) {
      this.#motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.#motionQuery.addEventListener?.('change', this.#onMotionChange);
    }
    document.addEventListener('visibilitychange', this.#onVisibility);

    this.#applyMotionPreference();
    this.#relayout();
    this.#wake();
  }

  disconnectedCallback(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = null;
    this.#motionQuery?.removeEventListener?.('change', this.#onMotionChange);
    this.#motionQuery = null;
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'disabled') {
      this.#button.disabled = value !== null;
      if (value !== null) {
        this.#interaction.hoverTarget = 0;
        this.#interaction.pressTarget = 0;
        this.removeAttribute('data-pressed');
      }
      this.#wake();
      return;
    }
    if (name === 'status') {
      const next = isStatus(value) ? value : null;
      if (next === this.#status) return;
      const old = this.#status;
      this.#status = next;
      this.#applyStatus();
      this.dispatchEvent(
        new CustomEvent<StatusChangeDetail>('statuschange', {
          detail: { oldStatus: old, newStatus: next },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    if (name === 'icon') {
      this.#renderIcon();
      return;
    }
    const def = attrToParam(name);
    if (!def) return;
    if (value === null) delete this.#explicit[def.name];
    else this.#explicit[def.name] = parseParam(def, value);
    this.#recomputeParams();
    this.#wake();
  }

  // --------------------------------------------------------------- status

  #recomputeParams(): void {
    const preset = this.#status ? STATUS_PRESETS[this.#status].params : {};
    this.#effective = { ...defaults(), ...preset, ...this.#explicit };
  }

  #applyStatus(): void {
    const preset = this.#status ? STATUS_PRESETS[this.#status] : null;
    const palette = this.#customPalette ?? preset?.palette ?? DEFAULT_PALETTE;
    flattenPalette(palette, this.#paletteTarget);
    if (this.#hasRendered) {
      this.#paletteSettled = false;   // crossfade from the current colours
    } else {
      this.#palette.set(this.#paletteTarget); // first paint: show the status immediately
      this.#paletteSettled = true;
    }
    this.style.setProperty('--fgb-icon-color', palette.icon);
    this.#srStatus.textContent = preset ? `Status: ${preset.label}` : '';
    this.#recomputeParams();
    this.#renderIcon();
    this.#wake();
  }

  #renderIcon(): void {
    const preset = this.#status ? STATUS_PRESETS[this.#status] : null;
    const slot = this.#icon.querySelector('slot')!;
    const hide = !preset || this.getAttribute('icon') === 'none';
    this.#icon.toggleAttribute('hidden', hide);
    // Built-in icon is the slot's fallback content; a consumer's slot="icon"
    // element replaces it automatically.
    slot.innerHTML = preset ? ICONS[preset.icon] : '';
  }

  /** Ease the uploaded palette toward the target; returns true when settled. */
  #stepPalette(dt: number): boolean {
    if (this.#paletteSettled) return true;
    let maxDiff = 0;
    for (let i = 0; i < this.#palette.length; i++) {
      this.#palette[i] = expSmooth(this.#palette[i], this.#paletteTarget[i], PALETTE_RATE, dt);
      maxDiff = Math.max(maxDiff, Math.abs(this.#palette[i] - this.#paletteTarget[i]));
    }
    if (maxDiff < 2e-3) {
      this.#palette.set(this.#paletteTarget);
      this.#paletteSettled = true;
    }
    return this.#paletteSettled;
  }

  // ------------------------------------------------------------------ rendering

  #attachRenderer(): void {
    if (this.#rendererTried) return;
    this.#rendererTried = true;
    this.#renderer = Renderer.create(this.#canvas);
    this.dataset.renderer = this.#renderer ? 'webgl2' : 'css';
    if (this.#renderer) {
      this.#canvas.addEventListener('webglcontextlost', this.#onContextLost);
      this.#canvas.addEventListener('webglcontextrestored', this.#onContextRestored);
    }
  }

  #onContextLost = (e: Event): void => {
    e.preventDefault();
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  };

  #onContextRestored = (): void => {
    this.#renderer?.dispose();
    this.#rendererTried = false;
    this.#renderer = null;
    this.#attachRenderer();
    this.#relayout();
    this.#wake();
  };

  get #reduced(): boolean {
    if (this.#reducedOverride !== 'auto') return this.#reducedOverride;
    return this.#motionQuery?.matches ?? false;
  }

  #onMotionChange = (): void => this.#applyMotionPreference();

  #applyMotionPreference(): void {
    this.dataset.motion = this.#reduced ? 'reduced' : 'full';
    this.#wake();
  }

  #onVisibility = (): void => {
    if (!document.hidden) this.#wake();
  };

  /** Measure the pill, size the oversized canvas around it, and tell the renderer. */
  #relayout(): void {
    if (!this.#renderer) return;
    const w = this.#button.offsetWidth;
    const h = this.#button.offsetHeight;
    if (w === 0 || h === 0) return;
    const padX = PAD_X * h;
    const padTop = PAD_TOP * h;
    const padBottom = PAD_BOTTOM * h;
    const cssW = w + padX * 2;
    const cssH = h + padTop + padBottom;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const canvas = this.#canvas;
    canvas.style.left = `${-padX}px`;
    canvas.style.top = `${-padTop}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const layout: Layout = {
      canvasW: pw,
      canvasH: ph,
      pillX: padX * dpr,
      pillY: padTop * dpr,
      pillW: w * dpr,
      pillH: h * dpr,
    };
    this.#renderer.resize(layout);
    this.#pointerRect = null;
    this.#wake();
  }

  /** Request rendering; the loop keeps itself alive only while motion is needed. */
  #wake(): void {
    this.#needsFrame = true;
    this.#lastNow = 0;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#raf || !this.#renderer || !this.isConnected || !this.#visible) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof requestAnimationFrame !== 'function') return;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  #tick = (now: number): void => {
    this.#raf = 0;
    const renderer = this.#renderer;
    if (!renderer) return;
    const dt = this.#lastNow ? Math.min(MAX_DT, (now - this.#lastNow) / 1000) : 0;
    this.#lastNow = now;

    const settled = this.#interaction.step(dt) && this.#stepPalette(dt);
    const reduced = this.#reduced;
    if (!reduced) this.#fireTime += dt * this.#effective.fireSpeed;

    const s = this.#interaction.state;
    this.#hasRendered = true;
    renderer.render({
      time: this.#fireTime,
      dt,
      params: this.#effective,
      hover: s.hover,
      palette: this.#palette,
      press: s.press,
      pulse: s.pulse,
      pointerX: s.pointerX,
      pointerY: s.pointerY,
    });

    // Full motion: run continuously. Reduced motion: only while state eases.
    const keepGoing = !reduced || !settled || this.#needsFrame;
    this.#needsFrame = false;
    if (keepGoing) this.#schedule();
  };

  // ---------------------------------------------------------------- interaction

  #bindEvents(): void {
    const b = this.#button;
    b.addEventListener('pointerenter', (e) => {
      if (this.disabled) return;
      this.#pointerRect = b.getBoundingClientRect();
      this.#interaction.hoverTarget = 1;
      this.#updatePointer(e);
      this.#wake();
    });
    b.addEventListener('pointermove', (e) => {
      if (this.disabled) return;
      this.#updatePointer(e);
    });
    b.addEventListener('pointerleave', () => {
      this.#interaction.hoverTarget = 0;
      this.#release();
    });
    b.addEventListener('pointerdown', (e) => {
      if (this.disabled || e.button !== 0) return;
      this.#press();
    });
    b.addEventListener('pointerup', () => this.#release());
    b.addEventListener('pointercancel', () => this.#release());
    b.addEventListener('keydown', (e) => {
      if (this.disabled || e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter') {
        this.#keyPressed = true;
        this.#press();
      }
    });
    b.addEventListener('keyup', () => {
      if (this.#keyPressed) {
        this.#keyPressed = false;
        this.#release();
      }
    });
    b.addEventListener('blur', () => {
      this.#keyPressed = false;
      this.#release();
    });
    b.addEventListener('click', () => {
      if (this.disabled) return;
      this.#interaction.trigger();
      this.#wake();
    });
  }

  #updatePointer(e: PointerEvent): void {
    const r = this.#pointerRect ?? (this.#pointerRect = this.#button.getBoundingClientRect());
    if (r.width === 0 || r.height === 0) return;
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.#interaction.setPointer(Math.max(-1.2, Math.min(1.2, x)), Math.max(-1.2, Math.min(1.2, y)));
    this.#wake();
  }

  #press(): void {
    this.#interaction.pressTarget = 1;
    this.setAttribute('data-pressed', '');
    this.#wake();
  }

  #release(): void {
    if (this.#interaction.pressTarget === 0) return;
    this.#interaction.pressTarget = 0;
    this.removeAttribute('data-pressed');
    this.#wake();
  }
}

if (!customElements.get('fire-glass-button')) {
  customElements.define('fire-glass-button', FireGlassButton);
}

declare global {
  interface HTMLElementTagNameMap {
    'fire-glass-button': FireGlassButton;
  }
}
