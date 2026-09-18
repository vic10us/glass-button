/**
 * Separable Gaussian blur used for bloom and as the fire's illuminance map.
 *
 * Run twice: once with uDir = (1/w, 0) into a temporary target, then with
 * uDir = (0, 1/h). Nine taps with linear-sampling offsets give the response
 * of a 17-tap kernel. The first pass also acts as the downsample from the
 * fire buffer because it renders into the smaller target.
 */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uDir;   // (1/width, 0) or (0, 1/height) of the *source* texture, times radius

void main() {
  // Weights for a Gaussian with sigma ~ 3 texels, sampled between texels so
  // bilinear filtering averages pairs (Rastergrid "linear sampling" trick).
  const float w0 = 0.2270270270;
  const float w1 = 0.3162162162;
  const float w2 = 0.0702702703;
  const float o1 = 1.3846153846;
  const float o2 = 3.2307692308;
  vec4 c = texture(uSrc, vUv) * w0;
  c += texture(uSrc, vUv + uDir * o1) * w1;
  c += texture(uSrc, vUv - uDir * o1) * w1;
  c += texture(uSrc, vUv + uDir * o2) * w2;
  c += texture(uSrc, vUv - uDir * o2) * w2;
  fragColor = c;
}
`;
