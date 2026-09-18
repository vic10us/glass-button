/**
 * WebGL2 renderer.
 *
 * Owns the context, shader programs and offscreen targets, and draws the
 * three passes described in the spec: fire (low-res HDR), bloom (quarter-res
 * blur) and composite (full-res glass). The element calls `resize()` when the
 * pill's measured size changes and `render()` once per animation frame; no
 * DOM access happens here.
 */
import { type GL, type RenderTarget, type Uniforms, createProgram, deleteRenderTarget, getUniforms } from './gl';
import { PARAM_DEFS, type Params } from './params';
import { COMPOSITE_FRAG } from './shaders/composite.frag';
import { QUAD_VERT } from './shaders/quad.vert';

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

/** Canvas and pill rectangle in device pixels; pill y is measured from the top. */
export interface Layout {
  canvasW: number;
  canvasH: number;
  pillX: number;
  pillY: number;
  pillW: number;
  pillH: number;
}

const COMPOSITE_UNIFORMS = [
  'uRes',
  'uPillCenter',
  'uPillSize',
  'uTime',
  'uHover',
  'uPress',
  'uPulse',
  'uPointer',
  'uParams',
] as const;

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
  /** True when RGBA16F render targets are available (HDR fire without banding). */
  readonly hdr: boolean;

  private layout: Layout | null = null;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly composite: WebGLProgram;
  private readonly compositeU: Uniforms;
  private readonly paramBuf = new Float32Array(12);
  private targets: RenderTarget[] = [];

  protected constructor(gl: GL) {
    this.gl = gl;
    this.hdr = gl.getExtension('EXT_color_buffer_float') !== null;
    this.vao = gl.createVertexArray();
    this.composite = createProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
    this.compositeU = getUniforms(gl, this.composite, COMPOSITE_UNIFORMS);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  resize(layout: Layout): void {
    this.layout = layout;
  }

  render(frame: RenderFrame): void {
    const { gl } = this;
    const L = this.layout;
    if (!L || gl.isContextLost()) return;

    this.packParams(frame.params);
    gl.bindVertexArray(this.vao);

    // --- composite -> canvas (premultiplied alpha over the page) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, L.canvasW, L.canvasH);
    gl.disable(gl.BLEND);
    gl.useProgram(this.composite);
    const u = this.compositeU;
    gl.uniform2f(u.uRes, L.canvasW, L.canvasH);
    // Pill centre in GL coordinates (origin bottom-left).
    gl.uniform2f(u.uPillCenter, L.pillX + L.pillW / 2, L.canvasH - (L.pillY + L.pillH / 2));
    gl.uniform2f(u.uPillSize, L.pillW, L.pillH);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform1f(u.uHover, frame.hover);
    gl.uniform1f(u.uPress, frame.press);
    gl.uniform1f(u.uPulse, frame.pulse);
    gl.uniform2f(u.uPointer, frame.pointerX, frame.pointerY);
    gl.uniform4fv(u.uParams, this.paramBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    for (const t of this.targets) deleteRenderTarget(gl, t);
    this.targets = [];
    gl.deleteProgram(this.composite);
    gl.deleteVertexArray(this.vao);
  }

  /** Pack the parameter table into three vec4s in PARAM_DEFS order. */
  private packParams(params: Params): void {
    for (let i = 0; i < PARAM_DEFS.length; i++) this.paramBuf[i] = params[PARAM_DEFS[i].name];
  }
}
