/**
 * Fire pass: procedural combustion rendered into a low-resolution HDR buffer.
 *
 * The buffer covers the pill rectangle plus a margin (so refraction in the
 * composite pass can sample slightly outside the silhouette). Coordinates:
 *   x  in pill-height units, 0 at the pill centre, ±halfW at the ends.
 *   fy in pill-height units, 0 at the pill's bottom edge, 1 at its top.
 *
 * How the flame field is built (all frequencies are per pill height):
 *   1. A low-frequency 3D noise field, evaluated with time as the third
 *      axis, gives a slowly evolving "wind" that warps the domain. This is
 *      the turbulence that makes tongues lean, curl and split instead of
 *      just rising.
 *   2. Two FBM layers are sampled in the warped domain while their y axis is
 *      advected upward over time (subtracting time from y). The layers use
 *      different scales, speeds and warp amounts so their motion never
 *      lines up: the coarse layer forms the tongues, the fine layer adds
 *      flicker and ragged tips. Both are stretched vertically (lower y
 *      frequency than x) so features are taller than wide.
 *   3. Density = noise - (height cost). The cost grows with fy / ceiling, so
 *      combustion is dense at the base and only the strongest noise peaks
 *      survive near the ceiling: thin, irregular, transparent tips. The
 *      ceiling rises toward the rounded ends so flames climb the end walls
 *      as in the reference.
 *   4. Density maps to temperature -> colour: deep red edge, orange body,
 *      yellow, then white-hot HDR core. Alpha is a soft step on density.
 *   5. A dim, low-alpha smoke layer above the flames.
 * Output is premultiplied HDR colour; uEncode scales it into range when the
 * target is 8-bit.
 */
import { NOISE_GLSL } from './noise.glsl';

export const FIRE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uExtent;   // half-width, half-height of the buffer in pill units
uniform float uHalfW;   // pill half-width in pill units
uniform float uTime;
uniform float uHover;
uniform float uPress;
uniform float uPulse;
uniform float uEncode;  // 1.0 for float targets, <1 to fit HDR into 8 bits
uniform vec4 uParams[3];

#define P_FIRE_INTENSITY  uParams[0].x
#define P_FIRE_HEIGHT     uParams[0].y
#define P_TURBULENCE      uParams[0].z

${NOISE_GLSL}

// Temperature ramp in linear light. Values above 1 are intentional: the
// composite pass tonemaps, and the bloom pass picks them up.
vec3 fireColor(float heat) {
  vec3 c = vec3(0.0);
  vec3 deepRed = vec3(0.55, 0.015, 0.0);
  vec3 red     = vec3(1.1, 0.10, 0.0);
  vec3 orange  = vec3(1.6, 0.42, 0.02);
  vec3 yellow  = vec3(2.4, 1.35, 0.25);
  vec3 white   = vec3(3.6, 3.1, 2.2);
  c = mix(deepRed, red, smoothstep(0.0, 0.2, heat));
  c = mix(c, orange, smoothstep(0.2, 0.55, heat));
  c = mix(c, yellow, smoothstep(0.6, 1.0, heat));
  c = mix(c, white, smoothstep(1.1, 1.6, heat));
  return c;
}

void main() {
  // Buffer uv -> pill units, origin at the pill's bottom centre.
  vec2 q = (vUv - 0.5) * 2.0 * uExtent;
  float x = q.x;
  float fy = q.y + 0.5;

  float t = uTime;
  float turb = P_TURBULENCE;
  float hover = uHover;
  float press = uPress;

  // ---- 1. slowly evolving wind field --------------------------------------
  vec3 wp = vec3(x * 1.6, fy * 2.2 - t * 0.35, t * 0.28);
  vec2 wind = vec2(snoise(wp + vec3(3.1, 7.7, 0.0)), snoise(wp + vec3(9.4, 1.3, 5.0)));

  // ---- 2. two advected FBM layers -----------------------------------------
  // Coarse tongues. x frequency higher than y so features are tall.
  vec2 w0 = wind * 0.32 * turb;
  vec3 p0 = vec3(x * 3.2 + w0.x, fy * 1.9 - t * 1.05 + w0.y, t * 0.45);
  float n0 = fbm(p0);
  // Fine flicker and ragged tips: faster, smaller, more warp.
  vec2 w1 = wind * 0.55 * turb;
  vec3 p1 = vec3(x * 7.5 + w1.x + 17.0, fy * 4.5 - t * 2.1 + w1.y, t * 0.9 + 3.0);
  float n1 = fbm(p1);
  // Hot filaments inside the tongues.
  float rd = ridged(vec3(x * 6.0 + w0.x * 1.4, fy * 4.5 - t * 1.6 + w0.y, t * 0.6 + 11.0));

  // ---- 3. height cost -----------------------------------------------------
  // Ceiling: ~0.3 of the pill height at idle, higher on hover, and rising
  // toward the rounded ends where the flames climb the end walls.
  float endT = smoothstep(0.55, 1.0, abs(x) / max(uHalfW, 0.5));
  float endLift = endT * 0.30;
  float ceilH = (0.40 + endLift) * P_FIRE_HEIGHT * (1.0 + 0.22 * hover + 0.10 * press);
  float h = fy / max(ceilH, 1e-3);

  float noise = n0 * 0.92 + n1 * 0.09 + rd * 0.13;
  // Gaps between tongues exist even at the base; survival gets sparse
  // toward the ceiling.
  float density = noise * 1.9 - 0.78 - h * h * 0.8 - h * 0.25;
  // The base is always burning: a thin bright fuel line along the bottom.
  density += 0.3 * exp(-abs(fy) * 10.0);
  // The fuel line continues a little below the pill's bottom edge so the
  // bottom fillet's refraction has something bright to magnify; the
  // composite pass clips it to the silhouette. Nothing far above the ceiling.
  density *= smoothstep(-0.14, -0.07, fy);
  // Confine combustion to the pill silhouette (the bottom is treated as
  // extending downward so the fuel line below the edge survives).
  vec2 pp = vec2(x, max(fy, 0.02) - 0.5);
  vec2 pq = vec2(max(abs(pp.x) - (uHalfW - 0.5), 0.0), pp.y);
  float dPill = length(pq) - 0.5;
  density *= 1.0 - smoothstep(-0.04, 0.03, dPill);
  density *= 1.0 - smoothstep(1.15, 1.6, h);

  float intensity = P_FIRE_INTENSITY * (1.0 + 0.22 * hover + 0.18 * press + 0.30 * uPulse);
  float heat = max(density, 0.0) * intensity;

  // ---- 4. colour ----------------------------------------------------------
  vec3 col = fireColor(heat);
  float alpha = smoothstep(0.0, 0.26, heat);
  // Tips thin out and go translucent.
  alpha *= 1.0 - 0.55 * smoothstep(0.55, 1.2, h);
  // Brightness rises with heat; keep the red edges dim so they stay edge-like.
  vec3 fire = col * alpha * (0.35 + 0.65 * smoothstep(0.0, 0.5, heat)) * (0.85 + 0.35 * intensity);

  // ---- 5. smoke -----------------------------------------------------------
  float sm = fbm(vec3(x * 2.0 + wind.x * 0.4, fy * 2.4 - t * 0.5, t * 0.2 + 40.0));
  float smokeBand = smoothstep(ceilH * 0.7, ceilH * 1.4, fy) * (1.0 - smoothstep(ceilH * 1.5, ceilH * 3.4, fy));
  float smokeA = smoothstep(0.5, 0.9, sm) * smokeBand * 0.02 * intensity;
  smokeA *= 1.0 - smoothstep(-0.1, 0.0, dPill);
  vec3 smoke = vec3(0.30, 0.26, 0.24) * smokeA;

  vec3 rgb = fire + smoke;
  float a = clamp(alpha + smokeA, 0.0, 1.0);
  fragColor = vec4(rgb * uEncode, a);
}
`;
