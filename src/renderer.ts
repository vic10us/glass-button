/**
 * WebGL2 renderer.
 *
 * Owns the context, shader programs and offscreen targets, and draws the
 * three passes described in the spec:
 *   1. fire      -> fireTarget   (low-res HDR, sized from the pill height)
 *   2. blur x2   -> bloomTarget  (quarter-res of the fire buffer)
 *   3. composite -> canvas       (full device resolution, premultiplied)
 * The element calls `resize()` when the pill's measured size changes and
 * `render()` once per animation frame; no DOM access happens here.
 */
import {
  type GL,
  type RenderTarget,
  type Uniforms,
  createProgram,
  createRenderTarget,
  deleteRenderTarget,
  getUniforms,
} from './gl';
import { PARAM_DEFS, type Params } from './params';
import { BLUR_FRAG } from './shaders/blur.frag';
import { COMPOSITE_FRAG } from './shaders/composite.frag';
import { FIRE_FRAG } from './shaders/fire.frag';
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
  /** Flattened palette: 5 fire ramp colours then the rim tint (18 floats, see status.ts). */
  palette: Float32Array;
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

/** Fire buffer texel density: texels per pill height. Independent of DPR. */
const FIRE_TEXELS_PER_HEIGHT = 160;
const FIRE_MAX_WIDTH = 1024;
/** Margin around the pill covered by the fire buffer, in pill heights. */
const FIRE_MARGIN = 0.12;
/** Bloom runs at this fraction of the fire buffer resolution. */
const BLOOM_SCALE = 0.5;
/** Peak HDR value expected from the fire shader; used to encode into RGBA8 when floats are unavailable. */
const HDR_RANGE = 6;

const FIRE_UNIFORMS = ['uExtent', 'uHalfW', 'uTime', 'uHover', 'uPress', 'uPulse', 'uEncode', 'uParams', 'uFireRamp'] as const;
const BLUR_UNIFORMS = ['uSrc', 'uDir'] as const;
const COMPOSITE_UNIFORMS = [
  'uRes',
  'uPillCenter',
  'uPillSize',
  'uFireExtent',
  'uTime',
  'uHover',
  'uPress',
  'uPulse',
  'uPointer',
  'uParams',
  'uFire',
  'uBloom',
  'uDecode',
  'uRimTint',
  'uEmberColor',
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
  private readonly fireProg: WebGLProgram;
  private readonly blurProg: WebGLProgram;
  private readonly compositeProg: WebGLProgram;
  private readonly fireU: Uniforms;
  private readonly blurU: Uniforms;
  private readonly compositeU: Uniforms;
  private readonly paramBuf = new Float32Array(12);
  private readonly encode: number;

  private fireTarget: RenderTarget | null = null;
  private bloomA: RenderTarget | null = null;
  private bloomB: RenderTarget | null = null;
  /** Fire buffer half-extent in pill units (x, y). */
  private fireExtent = { x: 1, y: 0.5 };

  protected constructor(gl: GL) {
    this.gl = gl;
    this.hdr = gl.getExtension('EXT_color_buffer_float') !== null;
    this.encode = this.hdr ? 1 : 1 / HDR_RANGE;
    this.vao = gl.createVertexArray();
    this.fireProg = createProgram(gl, QUAD_VERT, FIRE_FRAG);
    this.blurProg = createProgram(gl, QUAD_VERT, BLUR_FRAG);
    this.compositeProg = createProgram(gl, QUAD_VERT, COMPOSITE_FRAG);
    this.fireU = getUniforms(gl, this.fireProg, FIRE_UNIFORMS);
    this.blurU = getUniforms(gl, this.blurProg, BLUR_UNIFORMS);
    this.compositeU = getUniforms(gl, this.compositeProg, COMPOSITE_UNIFORMS);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  resize(layout: Layout): void {
    this.layout = layout;
    const { gl } = this;
    // Fire buffer: fixed texel density relative to pill height so the fire
    // has the same detail at any size and scales rather than stretches.
    const aspect = layout.pillW / layout.pillH;
    const ex = aspect / 2 + FIRE_MARGIN;
    const ey = 0.5 + FIRE_MARGIN;
    this.fireExtent = { x: ex, y: ey };
    let fh = Math.round(FIRE_TEXELS_PER_HEIGHT * ey * 2);
    let fw = Math.round(fh * (ex / ey));
    if (fw > FIRE_MAX_WIDTH) {
      fh = Math.round((fh * FIRE_MAX_WIDTH) / fw);
      fw = FIRE_MAX_WIDTH;
    }
    fw = Math.max(fw, 8);
    fh = Math.max(fh, 8);
    if (!this.fireTarget || this.fireTarget.width !== fw || this.fireTarget.height !== fh) {
      deleteRenderTarget(gl, this.fireTarget);
      deleteRenderTarget(gl, this.bloomA);
      deleteRenderTarget(gl, this.bloomB);
      const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
      this.fireTarget = createRenderTarget(gl, fw, fh, fmt);
      const bw = Math.max(4, Math.round(fw * BLOOM_SCALE));
      const bh = Math.max(4, Math.round(fh * BLOOM_SCALE));
      this.bloomA = createRenderTarget(gl, bw, bh, fmt);
      this.bloomB = createRenderTarget(gl, bw, bh, fmt);
    }
  }

  render(frame: RenderFrame): void {
    const { gl } = this;
    const L = this.layout;
    const fire = this.fireTarget;
    const bloomA = this.bloomA;
    const bloomB = this.bloomB;
    if (!L || !fire || !bloomA || !bloomB || gl.isContextLost()) return;

    this.packParams(frame.params);
    gl.bindVertexArray(this.vao);
    const halfW = L.pillW / L.pillH / 2;

    // --- 1. fire -> fireTarget ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fire.fbo);
    gl.viewport(0, 0, fire.width, fire.height);
    gl.useProgram(this.fireProg);
    let u = this.fireU;
    gl.uniform2f(u.uExtent, this.fireExtent.x, this.fireExtent.y);
    gl.uniform1f(u.uHalfW, halfW);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform1f(u.uHover, frame.hover);
    gl.uniform1f(u.uPress, frame.press);
    gl.uniform1f(u.uPulse, frame.pulse);
    gl.uniform1f(u.uEncode, this.encode);
    gl.uniform4fv(u.uParams, this.paramBuf);
    gl.uniform3fv(u.uFireRamp, frame.palette, 0, 15);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- 2. bloom: horizontal blur (also downsamples) then vertical ---
    gl.useProgram(this.blurProg);
    u = this.blurU;
    gl.uniform1i(u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.viewport(0, 0, bloomA.width, bloomA.height);
    gl.bindTexture(gl.TEXTURE_2D, fire.tex);
    gl.uniform2f(u.uDir, 1.6 / fire.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
    gl.viewport(0, 0, bloomB.width, bloomB.height);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(u.uDir, 0, 1.6 / bloomA.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Second, wider blur pass for softer illuminance (ping-pong back to A, then B).
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.uniform2f(u.uDir, 2.4 / bloomB.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(u.uDir, 0, 2.4 / bloomA.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- 3. composite -> canvas (premultiplied alpha over the page) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, L.canvasW, L.canvasH);
    gl.useProgram(this.compositeProg);
    u = this.compositeU;
    gl.uniform2f(u.uRes, L.canvasW, L.canvasH);
    // Pill centre in GL coordinates (origin bottom-left).
    gl.uniform2f(u.uPillCenter, L.pillX + L.pillW / 2, L.canvasH - (L.pillY + L.pillH / 2));
    gl.uniform2f(u.uPillSize, L.pillW, L.pillH);
    gl.uniform2f(u.uFireExtent, this.fireExtent.x, this.fireExtent.y);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform1f(u.uHover, frame.hover);
    gl.uniform1f(u.uPress, frame.press);
    gl.uniform1f(u.uPulse, frame.pulse);
    gl.uniform2f(u.uPointer, frame.pointerX, frame.pointerY);
    gl.uniform4fv(u.uParams, this.paramBuf);
    gl.uniform1f(u.uDecode, 1 / this.encode);
    gl.uniform3f(u.uRimTint, frame.palette[15], frame.palette[16], frame.palette[17]);
    // Embers glow with the "hot" ramp stop.
    gl.uniform3f(u.uEmberColor, frame.palette[9] * 1.1, frame.palette[10] * 1.1, frame.palette[11] * 1.1);
    gl.uniform1i(u.uFire, 0);
    gl.uniform1i(u.uBloom, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fire.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    deleteRenderTarget(gl, this.fireTarget);
    deleteRenderTarget(gl, this.bloomA);
    deleteRenderTarget(gl, this.bloomB);
    this.fireTarget = this.bloomA = this.bloomB = null;
    gl.deleteProgram(this.fireProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compositeProg);
    gl.deleteVertexArray(this.vao);
  }

  /** Pack the parameter table into three vec4s in PARAM_DEFS order. */
  private packParams(params: Params): void {
    for (let i = 0; i < PARAM_DEFS.length; i++) this.paramBuf[i] = params[PARAM_DEFS[i].name];
  }
}
