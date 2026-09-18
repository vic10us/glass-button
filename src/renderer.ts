/**
 * WebGL2 renderer (skeleton). Filled in by the shading stages; this version
 * only owns the context and clears the canvas so the element wiring can be
 * built and tested around a stable interface.
 */
import type { Params } from './params';
import type { GL } from './gl';

export interface RenderFrame {
  /** Fire time in seconds (already scaled by fireSpeed, frozen under reduced motion). */
  time: number;
  dt: number;
  params: Params;
  hover: number;
  press: number;
  pulse: number;
  pointerX: number;
  pointerY: number;
}

/** Canvas and pill rectangle in device pixels. */
export interface Layout {
  canvasW: number;
  canvasH: number;
  pillX: number;
  pillY: number;
  pillW: number;
  pillH: number;
}

export class Renderer {
  /** Returns null when WebGL2 is unavailable so the element can fall back to CSS. */
  static create(canvas: HTMLCanvasElement): Renderer | null {
    let gl: GL | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      }) as GL | null;
    } catch {
      gl = null;
    }
    if (!gl) return null;
    try {
      return new Renderer(gl);
    } catch (err) {
      console.error('[fire-glass-button] renderer init failed, using CSS fallback', err);
      return null;
    }
  }

  readonly gl: GL;
  protected layout: Layout | null = null;

  protected constructor(gl: GL) {
    this.gl = gl;
  }

  resize(layout: Layout): void {
    this.layout = layout;
  }

  render(_frame: RenderFrame): void {
    const { gl } = this;
    if (!this.layout || gl.isContextLost()) return;
    gl.viewport(0, 0, this.layout.canvasW, this.layout.canvasH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    /* nothing yet */
  }
}
