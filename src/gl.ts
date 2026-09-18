/**
 * Small WebGL2 helpers. Deliberately thin: the renderer only needs shader
 * programs, float render targets and a way to set uniforms by name.
 */

export type GL = WebGL2RenderingContext;

export class ShaderError extends Error {}

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    // Include numbered source so the reported line maps back to the shader.
    const numbered = source
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(3)}: ${l}`)
      .join('\n');
    throw new ShaderError(`Shader compile failed:\n${log}\n${numbered}`);
  }
  return shader;
}

export function createProgram(gl: GL, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new ShaderError('createProgram failed');
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new ShaderError(`Program link failed: ${log}`);
  }
  return program;
}

export type Uniforms = Record<string, WebGLUniformLocation | null>;

/** Resolve uniform locations once at program creation instead of every frame. */
export function getUniforms(gl: GL, program: WebGLProgram, names: readonly string[]): Uniforms {
  const out: Uniforms = {};
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Colour render target. `internalFormat` is RGBA16F when float rendering is
 * supported (HDR fire and bloom), otherwise RGBA8.
 */
export function createRenderTarget(gl: GL, width: number, height: number, internalFormat: number, linear = true): RenderTarget {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new ShaderError('createRenderTarget failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    throw new ShaderError(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { fbo, tex, width, height };
}

export function deleteRenderTarget(gl: GL, rt: RenderTarget | null | undefined): void {
  if (!rt) return;
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.tex);
}
