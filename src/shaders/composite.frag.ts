/**
 * Composite pass, stage 2: thick glass pill lit by a cool studio environment.
 *
 * Coordinate convention used throughout:
 *   p  = fragment position relative to the pill centre, in units of pill
 *        height, y up. The pill spans y in [-0.5, 0.5] and x in
 *        [-halfW, halfW] with halfW = (width / height) / 2.
 *   d  = signed distance to the pill silhouette (negative inside).
 *   u  = 1 + d / 0.5: 0 along the pill's centre line, 1 at the silhouette.
 *
 * Glass model. The pill is treated as a slab with a rounded (filleted) edge
 * zone whose width is set by glassThickness. Inside the flat region the
 * normal points at the viewer; through the fillet it rotates until it is
 * tangent to the screen at the silhouette. From that normal we get:
 *   - Fresnel (Schlick), strong only where the normal is tilted, so the edge
 *     zone catches far more light than the centre.
 *   - A reflection vector into a procedural studio: a bright cool softbox
 *     above/in front (follows the pointer), a dark backdrop behind the
 *     camera, and two cool blue side lights that give the end caps their
 *     cyan glints.
 *   - "Edge light": light transported inside the slab exits at the
 *     silhouette, which is why real glass edges glow as thin lines.
 */
import { NOISE_GLSL } from './noise.glsl';

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
uniform vec2 uPointer;     // eased pointer, pill-normalised (-1..1), y up
uniform vec4 uParams[3];

#define P_FIRE_INTENSITY  uParams[0].x
#define P_FIRE_HEIGHT     uParams[0].y
#define P_TURBULENCE      uParams[0].z
#define P_FIRE_SPEED      uParams[0].w
#define P_GLASS_OPACITY   uParams[1].x
#define P_GLASS_THICKNESS uParams[1].y
#define P_REFRACTION      uParams[1].z
#define P_BLOOM           uParams[1].w
#define P_REFLECTION      uParams[2].x
#define P_EMBERS          uParams[2].y
#define P_HEAT            uParams[2].z

${NOISE_GLSL}

// Signed distance to a pill (stadium) of half-height 0.5.
float pillSdf(vec2 p, float halfW) {
  vec2 q = vec2(max(abs(p.x) - (halfW - 0.5), 0.0), p.y);
  return length(q) - 0.5;
}

// Outward gradient of the pill SDF (unit length except on the centre line).
vec2 pillGrad(vec2 p, float halfW) {
  vec2 q = vec2(max(abs(p.x) - (halfW - 0.5), 0.0), p.y);
  float len = max(length(q), 1e-4);
  return vec2(sign(p.x) * q.x, q.y) / len;
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ACES filmic curve (Narkowicz fit). Keeps the fire's hottest values from
// clipping to flat white and gives the highlights a photographic roll-off.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Procedural studio environment sampled with a reflection direction.
// +z points at the camera; +y is up. Directions are compared with a
// gaussian in direction space, i.e. exp(-|R - L|^2 * k): small k = broad
// soft light, large k = tight specular source.
vec3 studio(vec3 R, vec2 pointer) {
  // Backdrop behind the camera: near black, faintly cool.
  vec3 col = vec3(0.010, 0.012, 0.018);
  // Ceiling: broad cool light from above. Gives the upper face its sheen.
  float up = smoothstep(-0.1, 1.0, R.y);
  col += vec3(0.5, 0.58, 0.72) * up * up * 0.55;
  // Key: a wide strip softbox above and slightly behind the pill, the
  // classic product-shot rim light. Anisotropic (wide in x, thin in y) so it
  // draws a crisp bright line along the top edge. The pointer slides it.
  vec3 key = normalize(vec3(pointer.x * 0.5, 0.86 + pointer.y * 0.2, -0.22 + pointer.y * 0.25));
  vec3 dk = R - key;
  float strip = exp(-(dk.x * dk.x * 1.0 + dk.y * dk.y * 28.0 + dk.z * dk.z * 28.0));
  col += vec3(1.0, 1.0, 1.06) * strip * 34.0;
  // Fill: soft front light above the camera for the gentle face gradient.
  vec3 fill = normalize(vec3(pointer.x * 0.7, 0.55 + pointer.y * 0.3, 0.85));
  vec3 df = R - fill;
  float soft = exp(-dot(df, df) * 4.0);
  col += vec3(0.9, 0.95, 1.05) * soft * 1.3;
  // Two cool blue side lights slightly behind the pill: the broad cyan
  // arcs on the end caps.
  vec3 sideL = normalize(vec3(-0.8, 0.45, -0.3));
  vec3 sideR = normalize(vec3(0.8, 0.45, -0.3));
  vec3 dl = R - sideL;
  vec3 dr = R - sideR;
  float sl = exp(-dot(dl, dl) * 5.0);
  float sr = exp(-dot(dr, dr) * 5.0);
  col += vec3(0.4, 0.65, 1.0) * (sl + sr) * 9.0;
  return col;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uPillCenter) / uPillSize.y;
  float halfW = 0.5 * uPillSize.x / uPillSize.y;
  float d = pillSdf(p, halfW);
  float aa = fwidth(d);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // ---- surface normal from the cross-section profile -----------------
  vec2 g = pillGrad(p, halfW);                 // outward, in the screen plane
  float u = clamp(1.0 + d / 0.5, 0.0, 1.0);     // 0 centre line .. 1 silhouette
  // Fillet zone: the outer edgeW of the half-height is rounded. v runs
  // 0..1 across it. A circular fillet has normal tilt asin(v), so
  // tan(tilt) = v / sqrt(1 - v^2).
  float edgeW = clamp(0.32 * P_GLASS_THICKNESS, 0.05, 0.95);
  float v = clamp((u - (1.0 - edgeW)) / edgeW, 0.0, 0.995);
  float tilt = v / sqrt(1.0 - v * v);
  // The "flat" face is a very shallow dome so highlights drift across it.
  tilt += 0.18 * u * u;
  // Subtle roughness variation: micro-facets nudge the normal a little.
  float rough = snoise(vec3(p * 3.0, 3.7)) * 0.004;
  vec3 N = normalize(vec3(g * tilt + rough, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float NdV = max(dot(N, V), 0.0);

  // ---- reflection ------------------------------------------------------
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);   // Schlick Fresnel
  vec3 R = reflect(-V, N);
  vec3 env = studio(R, uPointer);
  vec3 reflection = env * F * P_REFLECTION;

  // Edge light: light guided inside the slab leaves through the silhouette
  // as a thin bright line. Cool on the upper half; the lower half is lit by
  // the fire in a later stage.
  float rim = pow(1.0 - NdV, 22.0);
  float upper = 0.25 + 0.75 * smoothstep(-0.4, 0.5, g.y);
  reflection += vec3(0.8, 0.9, 1.0) * rim * upper * 3.0 * P_REFLECTION;

  // ---- transmission ---------------------------------------------------
  // Dark tinted body. glassOpacity is how much of the page it hides.
  vec3 body = vec3(0.010, 0.011, 0.014);
  float bodyA = P_GLASS_OPACITY;

  vec3 color = body * bodyA * (1.0 - F) + reflection;
  float alpha = bodyA + (1.0 - bodyA) * F;

  // color is already light-weighted (premultiplied): tonemap, encode, mask.
  fragColor = vec4(linearToSrgb(aces(color)) * mask, alpha * mask);
}
`;
