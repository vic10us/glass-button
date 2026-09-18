/**
 * <fire-glass-button>
 *
 * A real <button> with slotted HTML text, sitting on top of a transparent,
 * oversized WebGL2 canvas that renders the glass pill, the fire inside it and
 * the glow beneath it. This file owns the DOM, attribute/property plumbing,
 * accessibility and the frame loop; all shading lives in the renderer.
 */
import { InteractionState } from './interaction';
import { PARAM_ATTRS, PARAM_DEFS, type Params, attrToParam, defaults, parseParam } from './params';
import { type Layout, Renderer } from './renderer';
import { STYLES } from './styles';

export type { Params, ParamName } from './params';

/** Canvas padding around the pill, as multiples of the pill height (room for glow). */
const PAD_X = 0.9;
const PAD_TOP = 0.9;
const PAD_BOTTOM = 1.7;
const MAX_DPR = 2;
const MAX_DT = 0.1;

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `<style>${STYLES}</style>
<div class="frame">
  <canvas aria-hidden="true"></canvas>
  <button part="button" type="button"><span class="label"><slot></slot></span></button>
</div>`;

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FireGlassButton extends Params {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class FireGlassButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...PARAM_ATTRS, 'disabled'];
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
          return this.#params[def.name];
        },
        set(this: FireGlassButton, v: number) {
          this.setAttribute(def.attr, String(parseParam(def, v)));
        },
      });
    }
  }

  #params: Params = defaults();
  readonly #frame: HTMLDivElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #button: HTMLButtonElement;
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
    this.#bindEvents();
  }

  // ---------------------------------------------------------------- public API

  /** All parameters as a plain object. Setting merges the given keys. */
  get params(): Params {
    return { ...this.#params };
  }

  set params(patch: Partial<Params>) {
    for (const def of PARAM_DEFS) {
      const v = patch[def.name];
      if (v !== undefined) this[def.name] = v;
    }
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
    const def = attrToParam(name);
    if (!def) return;
    this.#params[def.name] = parseParam(def, value);
    this.#wake();
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

    const settled = this.#interaction.step(dt);
    const reduced = this.#reduced;
    if (!reduced) this.#fireTime += dt * this.#params.fireSpeed;

    const s = this.#interaction.state;
    renderer.render({
      time: this.#fireTime,
      dt,
      params: this.#params,
      hover: s.hover,
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
