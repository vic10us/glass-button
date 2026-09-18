/**
 * Composite pass, stage 1: pill silhouette with a flat dark body.
 *
 * Coordinate convention used by every later stage:
 *   p  = fragment position relative to the pill centre, in units of pill
 *        height, y up. The pill therefore spans y in [-0.5, 0.5] and
 *        x in [-halfW, halfW] with halfW = (width / height) / 2.
 *   d  = signed distance to the pill silhouette (negative inside).
 * Everything is expressed in pill-height units so the look is identical at
 * any button size; only the antialiasing width comes from screen pixels.
 */
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;         // canvas size in device pixels
uniform vec2 uPillCenter;  // pill centre in GL pixel coordinates (y up)
uniform vec2 uPillSize;    // pill width, height in device pixels
uniform float uTime;
uniform float uHover;
uniform float uPress;
uniform float uPulse;
uniform vec2 uPointer;
uniform vec4 uParams[3];

// Signed distance to a pill (stadium): a segment of half-length (halfW - r)
// with radius r = 0.5 (half the pill height).
float pillSdf(vec2 p, float halfW) {
  vec2 q = vec2(max(abs(p.x) - (halfW - 0.5), 0.0), p.y);
  return length(q) - 0.5;
}

vec3 linearToSrgb(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 p = (gl_FragCoord.xy - uPillCenter) / uPillSize.y;
  float halfW = 0.5 * uPillSize.x / uPillSize.y;
  float d = pillSdf(p, halfW);
  float aa = fwidth(d);
  float mask = 1.0 - smoothstep(-aa, aa, d);

  vec3 body = vec3(0.03, 0.032, 0.04);
  float alpha = 0.9 * mask;
  fragColor = vec4(linearToSrgb(body) * alpha, alpha);
}
`;
