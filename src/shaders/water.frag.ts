/**
 * Water pass: a lit liquid filling the lower part of the pill, rendered into
 * the same HDR buffer as the fire so the composite pass (refraction, rim
 * light, bloom, floor reflection) works unchanged.
 *
 * Coordinates match fire.frag: x in pill-height units from the centre, fy
 * from the pill's bottom edge (0) to its top (1).
 *
 * Construction:
 *   1. Surface height h(x): the fill level plus three travelling waves of
 *      different wavelength and speed, a slow slosh that tilts the whole
 *      surface, fine noise ripples, and a meniscus that climbs the rounded
 *      end walls. Hover raises the wave amplitude; a press sends a sharper
 *      ripple across; the click pulse adds a splash.
 *   2. Body: everything below h(x). Colour deepens with depth along the
 *      palette ramp (deep -> mid), so the bottom is dark and the surface
 *      zone bright.
 *   3. Caustics: two warped noise fields multiplied and sharpened give the
 *      bright, wandering light web of sunlight through water. They fade with
 *      depth and are strongest just under the surface.
 *   4. Surface: a thin specular line along the crest, brighter where the
 *      slope faces the key light, plus a soft glow band beneath it.
 *   5. Bubbles: sparse rising rings that only exist below the surface.
 *   6. Mist: faint haze just above the surface.
 * Output is premultiplied HDR colour scaled by uEncode; uFade lets the
 * renderer crossfade between effects by adding two passes.
 */
import { NOISE_GLSL } from './noise.glsl';

export const WATER_FRAG = /* glsl */ `#version 300 es
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
uniform float uFade;    // crossfade weight for this effect
uniform vec4 uParams[3];
uniform vec3 uRamp[5]; // palette ramp: deep, mid, light, bright, highlight

#define P_INTENSITY   uParams[0].x
#define P_LEVEL       uParams[0].y   // level -> water level
#define P_WAVES       uParams[0].z   // turbulence -> wave amplitude
#define P_BUBBLES     uParams[2].y   // particles -> bubbles
#define P_SHIMMER     uParams[2].z   // shimmer -> ripple detail

${NOISE_GLSL}

// Surface height at x. Returns the height and its slope (for lighting).
vec2 surface(float x, float t, float hover, float press, float pulse) {
  float amp = 0.02 * (0.6 + 0.4 * P_WAVES) * (1.0 + 1.0 * hover);
  float h = 0.0;
  float slope = 0.0;
  // Three travelling waves, incommensurate wavelengths and speeds so the
  // pattern never repeats visibly. Two travel right, one left.
  float k1 = 3.9, k2 = 8.9, k3 = 14.3;
  float p1 = x * k1 - t * 1.9, p2 = x * k2 + t * 2.6, p3 = x * k3 - t * 3.7;
  h += amp * (sin(p1) + 0.55 * sin(p2) + 0.3 * sin(p3));
  slope += amp * (k1 * cos(p1) + 0.55 * k2 * cos(p2) + 0.3 * k3 * cos(p3));
  // Slow slosh: the whole surface tilts back and forth.
  float sl = 0.018 * sin(t * 0.55) * (1.0 + 0.6 * hover);
  h += sl * x;
  slope += sl;
  // Fine ripples from noise.
  float r = snoise(vec3(x * 7.0, t * 1.4, 2.0)) * 0.004 * P_SHIMMER;
  h += r;
  // Press: a sharp ripple train from the centre; pulse: a splash bump.
  float rip = (0.012 * press + 0.02 * pulse) * sin(x * 16.0 - t * 9.0) * exp(-abs(x) * 0.9);
  h += rip;
  slope += (0.012 * press + 0.02 * pulse) * 16.0 * cos(x * 16.0 - t * 9.0) * exp(-abs(x) * 0.9);
  // Meniscus: water climbs the rounded end walls.
  float endT = smoothstep(0.7, 1.0, abs(x) / max(uHalfW, 0.5));
  h += endT * endT * 0.06;
  return vec2(h, slope);
}

void main() {
  vec2 q = (vUv - 0.5) * 2.0 * uExtent;
  float x = q.x;
  float fy = q.y + 0.5;
  float t = uTime;

  // ---- 1. surface ---------------------------------------------------------
  float level = 0.30 * P_LEVEL * (1.0 + 0.06 * uHover);
  vec2 sf = surface(x, t, uHover, uPress, uPulse);
  float h = level + sf.x;
  float depth = h - fy;                 // >0 below the surface
  // Antialiased body mask in pill units (~1.5 texels at 160 px/height).
  float inside = smoothstep(-0.006, 0.006, depth);

  // Confine to the pill silhouette, extending below the bottom edge so the
  // bottom fillet's refraction sees liquid.
  vec2 pp = vec2(x, max(fy, 0.02) - 0.5);
  vec2 pq = vec2(max(abs(pp.x) - (uHalfW - 0.5), 0.0), pp.y);
  float dPill = length(pq) - 0.5;
  float pillMask = (1.0 - smoothstep(-0.04, 0.03, dPill)) * smoothstep(-0.14, -0.07, fy);

  vec3 deep = uRamp[0], mid = uRamp[1], light = uRamp[2], bright = uRamp[3], hi = uRamp[4];

  // ---- 2. body colour by depth --------------------------------------------
  float dn = clamp(depth / max(h, 1e-3), 0.0, 1.0);   // 0 at surface, 1 at bottom
  vec3 body = mix(light * 0.28, mid * 0.36, smoothstep(0.0, 0.35, dn));
  body = mix(body, deep * 0.85, smoothstep(0.3, 0.9, dn));

  // ---- 3. caustics --------------------------------------------------------
  vec3 cp = vec3(x * 2.6, fy * 3.8, t * 0.3);
  vec2 warp = vec2(snoise(cp * 0.7 + vec3(5.0, 1.0, 0.0)), snoise(cp * 0.7 + vec3(1.0, 7.0, 3.0))) * 0.4;
  float c1 = snoise(vec3(x * 3.4 + warp.x, fy * 5.0 + warp.y - t * 0.35, t * 0.45));
  float c2 = snoise(vec3(x * 2.8 - warp.y + 20.0, fy * 4.4 + warp.x + t * 0.28, t * 0.4 + 9.0));
  float web = 1.0 - abs(c1 * c2);                      // bright where both fields cross zero
  float caustic = pow(smoothstep(0.78, 1.0, web), 2.0);
  // Caustics come and go in patches, and are strongest just under the surface.
  float patches = 0.45 + 0.55 * smoothstep(-0.3, 0.5, snoise(vec3(x * 1.2, fy * 2.0, t * 0.25 + 50.0)));
  caustic *= patches * exp(-depth * 3.5) * (0.7 + 0.6 * uHover);
  vec3 causticCol = bright * caustic * 0.7;

  // ---- 4. surface line and glow band --------------------------------------
  // Facing: slopes tilted toward the key light (above, slightly right) catch it.
  float facing = clamp(0.5 + sf.y * 6.0, 0.0, 1.0);
  float line = exp(-abs(depth) * 230.0);               // thin crest line
  float band = exp(-max(depth, 0.0) * 26.0);           // soft glow just under it
  // Sparkle along the crest so the line is not uniform.
  float sparkle = 0.6 + 0.4 * snoise(vec3(x * 9.0, t * 2.0, 7.0));
  vec3 surfaceCol = hi * line * (0.6 + 1.0 * facing) * sparkle * 1.3 + bright * band * 0.28;

  // ---- 5. bubbles ---------------------------------------------------------
  vec3 bubbles = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float cell = 0.07 + 0.03 * fi;
    float speed = 0.12 + 0.07 * fi;
    vec2 gp = vec2(x + 0.21 * fi, fy - t * speed);
    vec2 id = floor(gp / cell);
    vec4 hsh = hash42(id + vec2(9.0 * fi, 4.0));
    if (hsh.w > 0.22 * P_BUBBLES) continue;
    vec2 centre = (id + vec2(0.2) + hsh.xy * 0.6) * cell;
    centre.x += sin(t * (1.0 + hsh.z) + hsh.y * 6.28) * 0.006;
    float r = 0.005 + 0.006 * hsh.z;
    float dist = length(gp - centre);
    float ring = smoothstep(r * 0.45, r * 0.15, abs(dist - r * 0.8));
    float glint = smoothstep(r * 0.35, 0.0, length(gp - centre - vec2(-r * 0.3, r * 0.3)));
    bubbles += (light * ring * 0.6 + hi * glint * 0.8) * (0.7 + 0.3 * hsh.x);
  }
  bubbles *= step(0.01, depth);                         // only under water

  // ---- combine body -------------------------------------------------------
  float intensity = P_INTENSITY * (1.0 + 0.25 * uHover + 0.15 * uPress + 0.3 * uPulse);
  vec3 col = (body + causticCol + bubbles) * inside + surfaceCol * smoothstep(-0.02, 0.0, depth);
  float alpha = inside * 0.9 + line * 0.5 * smoothstep(-0.02, 0.0, depth);

  // ---- 6. mist above the surface -------------------------------------------
  float above = max(-depth, 0.0);
  float mistN = fbm(vec3(x * 2.5, fy * 3.0 - t * 0.25, t * 0.15 + 30.0));
  float mist = smoothstep(0.5, 0.9, mistN) * exp(-above * 12.0) * (1.0 - inside) * 0.05;
  col += light * mist * 0.6;
  alpha += mist;

  col *= intensity * pillMask;
  alpha = clamp(alpha, 0.0, 1.0) * pillMask;
  fragColor = vec4(col * uEncode, alpha) * uFade;
}
`;
