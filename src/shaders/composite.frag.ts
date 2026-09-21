/**
 * Composite pass: thick glass pill lit by a cool studio environment and by
 * the fire inside it, plus the glow it throws on the floor.
 *
 * Coordinate convention used throughout:
 *   p  = fragment position relative to the pill centre, in units of pill
 *        height, y up. The pill spans y in [-0.5, 0.5] and x in
 *        [-halfW, halfW] with halfW = (width / height) / 2.
 *   d  = signed distance to the pill silhouette (negative inside).
 *   u  = 1 + d / 0.5: 0 along the pill's centre line, 1 at the silhouette.
 *
 * Glass model. The pill is a slab of tinted glass with a rounded (filleted)
 * edge zone whose width is set by glassThickness. Inside the flat region the
 * normal points at the viewer; through the fillet it rotates until it is
 * tangent to the screen at the silhouette. Light leaving a pixel is the sum
 * of four separate contributions:
 *
 *   1. Environment reflection, weighted by Schlick Fresnel. The environment
 *      has two parts: explicit studio lights (a cool strip softbox above and
 *      behind that follows the pointer, a soft fill, two side lights), which
 *      are added as colour; and the ambient surround, which is assumed to be
 *      the page the button sits on and is therefore expressed by *letting
 *      the page show through* (lower alpha) in proportion to F. On a black
 *      page the edges reflect black and stay glossy-dark; on a white page
 *      the same edges reflect white and read as bright glass. Nothing in the
 *      material is intrinsically dark.
 *   2. Transmission of the page through the tinted body: Beer-Lambert
 *      attenuation exp(-sigma * thickness), where thickness follows the
 *      cross-section (full slab at the centre, thinning through the fillet).
 *      glassOpacity sets sigma so the centre hides that fraction of the
 *      page; the curved edge is thinner and lets more through. A narrow
 *      total-internal-reflection band next to the silhouette reflects the
 *      interior (fire light) instead of transmitting the page.
 *   3. Emission from the effect inside: fire/water sampled through the
 *      refracting front surface with chromatic aberration and heat shimmer,
 *      plus bloom, embers and internal reflections. Dense flames also
 *      occlude the page so they stay saturated over bright surfaces.
 *   4. Illumination of the glass by the effect: warm Fresnel rim on the
 *      lower half and the ends, light scattered in the body (grows with
 *      thickness), and a faint mirror of the fire on the upper inner face.
 *
 * The output is premultiplied: colour = 1 + 3 + 4 (+ explicit lights), and
 * alpha = 1 - (page seen through reflection + page seen through the body).
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
uniform vec2 uFireExtent;  // half-extent of the fire buffer in pill units
uniform sampler2D uFire;   // premultiplied HDR fire (see fire.frag)
uniform sampler2D uBloom;  // blurred fire: bloom and illuminance
uniform float uDecode;     // undoes the fire pass encode scale
uniform vec3 uRimTint;     // status colour for edge light and side reflections
uniform vec3 uEmberColor;  // hot ramp colour for embers

#define P_INTENSITY  uParams[0].x
#define P_LEVEL     uParams[0].y
#define P_TURBULENCE      uParams[0].z
#define P_SPEED      uParams[0].w
#define P_GLASS_OPACITY   uParams[1].x
#define P_GLASS_THICKNESS uParams[1].y
#define P_REFRACTION      uParams[1].z
#define P_BLOOM           uParams[1].w
#define P_REFLECTION      uParams[2].x
#define P_PARTICLES          uParams[2].y
#define P_SHIMMER            uParams[2].z

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

// Encoded-space weight of the page behind a pixel: the brightness a white
// page adds on top of our own tonemapped light L (linear), measured after
// sRGB encoding. Luma-weighted because alpha is a single channel.
float pageWeight(vec3 L, vec3 encL, float through) {
  vec3 withPage = linearToSrgb(min(L + vec3(through), vec3(1.0)));
  return clamp(dot(withPage - encL, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
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
vec3 studio(vec3 R, vec2 pointer, vec3 rimTint) {
  // Explicit lights only. The ambient surround is the page itself and is
  // handled through alpha in main(), so there is no backdrop term here.
  vec3 col = vec3(0.0);
  // Ceiling: broad cool light from above. Gives the upper face its sheen.
  float up = smoothstep(-0.1, 1.0, R.y);
  col += vec3(0.5, 0.58, 0.72) * up * up * 0.45;
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
  col += vec3(0.9, 0.95, 1.05) * soft * 1.8;
  // Two cool blue side lights slightly behind the pill: the broad cyan
  // arcs on the end caps.
  vec3 sideL = normalize(vec3(-0.8, 0.45, -0.3));
  vec3 sideR = normalize(vec3(0.8, 0.45, -0.3));
  vec3 dl = R - sideL;
  vec3 dr = R - sideR;
  float sl = exp(-dot(dl, dl) * 5.0);
  float sr = exp(-dot(dr, dr) * 5.0);
  col += rimTint * (sl + sr) * 9.0;
  return col;
}

// Embers: two grids of sparse rising sparks, drawn at full resolution so
// they stay crisp. Coordinates are pill units; the grid scrolls upward.
vec3 embers(vec2 pillPos, float fy, float t, float density, vec3 color) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float cell = 0.085 + 0.03 * fi;
    float speed = 0.28 + 0.14 * fi;
    vec2 gp = vec2(pillPos.x + 0.35 * fi, fy - t * speed);
    vec2 id = floor(gp / cell);
    vec4 h = hash42(id + vec2(17.0 * fi, 3.0));
    if (h.w > 0.16 * density) continue;
    // Sideways drift so the spark does not rise in a straight line.
    vec2 centre = (id + vec2(0.15) + h.xy * 0.7) * cell;
    centre.x += sin(t * (1.5 + h.z * 2.0) + h.y * 6.28) * 0.012;
    float dist = length(gp - centre);
    float r = 0.0045 + 0.0025 * h.z;
    float dot_ = smoothstep(r, r * 0.25, dist);
    // Flicker and fade with height; sparks appear just above the fuel line.
    float life = smoothstep(0.05, 0.14, fy) * (1.0 - smoothstep(0.28, 0.62, fy + h.x * 0.2));
    float flicker = 0.55 + 0.45 * sin(t * (7.0 + h.w * 12.0) + h.x * 6.28);
    acc += color * dot_ * life * flicker;
  }
  return acc;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uPillCenter) / uPillSize.y;
  float halfW = 0.5 * uPillSize.x / uPillSize.y;
  float d = pillSdf(p, halfW);
  float aa = fwidth(d);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  float fy = p.y + 0.5;                       // 0 at the pill bottom, 1 at top
  float t = uTime;
  float hover = uHover;

  // Fire buffer lookup for a point in pill units.
  vec2 fireUvScale = 0.5 / uFireExtent;
  vec2 fireUv = p * fireUvScale + 0.5;

  // Illuminance map (blurred fire) at this point and a little lower, where
  // the fire actually is. Used for everything the fire lights.
  vec3 glow = texture(uBloom, fireUv).rgb * uDecode;
  vec3 glowLow = texture(uBloom, fireUv + vec2(0.0, -0.12)).rgb * uDecode;
  vec3 fireLight = glow * 0.6 + glowLow * 0.4;

  // =====================================================================
  // Inside the pill
  // =====================================================================
  vec3 inside = vec3(0.0);
  float throughIn = 0.0;   // linear fraction of the page seen through this pixel
  if (mask > 0.0) {
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

    // ---- geometry: thickness through the slab ---------------------------
    // Chord through the glass: full slab thickness on the flat face,
    // thinning through the fillet to a sliver at the silhouette (never zero:
    // the rim has real material). The exponent steepens the falloff so the
    // edge zone visibly clears rather than only the last few pixels.
    float profile = sqrt(1.0 - v * v);
    float thickness = mix(0.05, 1.0, pow(profile, 2.2));

    // ---- 1. environment reflection ---------------------------------------
    float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);   // Schlick Fresnel, n ~ 1.5
    vec3 R = reflect(-V, N);
    vec3 lights = studio(R, uPointer, uRimTint) * P_REFLECTION * (1.0 + 0.2 * hover);
    // The surround (the page) reflected at the same Fresnel weight. Slightly
    // below 1: a surround is never quite as bright as the surface under it.
    const float AMBIENT_ENV = 0.9;
    float reflectedPage = F * AMBIENT_ENV;

    // Edge light: light guided inside the slab leaves through the silhouette
    // as a thin bright line. Cool where the environment dominates, tinted by
    // the status colour.
    float rim = pow(1.0 - NdV, 22.0);
    float upper = 0.25 + 0.75 * smoothstep(-0.4, 0.5, g.y);
    vec3 edgeTint = mix(vec3(0.8, 0.9, 1.0), uRimTint, 0.45);
    vec3 edgeLight = edgeTint * rim * upper * 3.0 * P_REFLECTION;

    // ---- 2. transmission of the page through the tinted body --------------
    // Beer-Lambert: glassOpacity is the fraction hidden at full thickness.
    float sigma = -log(max(1.0 - P_GLASS_OPACITY, 0.005));
    float transmit = exp(-sigma * thickness);
    // Total internal reflection band: close to the silhouette the far face
    // is hit at grazing angles and mirrors the interior instead of passing
    // the page. Kept narrow and partial.
    float tir = 0.25 * smoothstep(0.75, 0.98, v);

    // ---- 3. emission from the effect inside -------------------------------
    // Refraction through the thick rounded edge. Horizontally the view bends
    // inward, so the effect wraps up the end walls; vertically the bottom
    // fillet acts as a lens on the bright base just below it (the effect
    // buffer extends below the pill for this). Offsets are in pill units and
    // grow with the surface tilt, i.e. toward the curved portions.
    vec2 refr = vec2(-N.x, 0.55 * N.y) * 0.11 * P_REFRACTION * P_GLASS_THICKNESS;
    // Heat shimmer: hot air above the flames wobbles the view slightly.
    float shimAmt = 0.006 * P_SHIMMER * smoothstep(0.15, 0.45, fy) * (1.0 - smoothstep(0.6, 1.0, fy));
    vec2 shim = vec2(snoise(vec3(p * 14.0, t * 2.6)), snoise(vec3(p * 14.0 + 31.0, t * 2.2))) * shimAmt;
    vec2 baseUv = fireUv + (shim + refr) * fireUvScale;
    // Chromatic aberration: red and blue refract slightly differently.
    vec2 ca = refr * fireUvScale * 0.12;
    vec4 fr = texture(uFire, baseUv + ca);
    vec4 fg = texture(uFire, baseUv);
    vec4 fb = texture(uFire, baseUv - ca);
    vec4 fire = vec4(fr.r, fg.g, fb.b, fg.a);
    fire.rgb *= uDecode;
    // Bloom: scattered light inside the slab around the tongues. Subtle.
    vec3 bloom = glow * 0.2 * P_BLOOM * (1.0 + 0.3 * hover);
    vec3 spark = embers(p, fy, t, P_PARTICLES, uEmberColor) * (1.0 + 0.3 * hover);
    // Dense flame is not transparent: it hides the page behind it, which is
    // what keeps the effect saturated over a white surface.
    float occlusion = min(1.0, 1.1 * fire.a);

    // ---- 4. the effect illuminating the glass -----------------------------
    // In-scatter in the tinted body above the flames: more glass, more glow.
    vec3 bleed = fireLight * 0.10 * exp(-fy * 4.0) * (0.5 + 0.5 * thickness)
               * (1.0 + 0.4 * hover + 0.6 * uPulse);
    // The fillet reflects the fire on the inside: warm Fresnel rim along the
    // bottom and up the ends, on top of the cool environment reflection.
    float fireRim = pow(1.0 - NdV, 3.0) * (1.0 - upper * 0.6);
    vec3 warmRim = fireLight * fireRim * 2.6 * P_REFLECTION;
    // Faint internal reflection of the fire on the upper inner surface.
    vec3 innerRefl = texture(uBloom, vec2(fireUv.x, 1.0 - fireUv.y)).rgb * uDecode
                   * 0.05 * smoothstep(0.35, 1.0, fy) * P_REFLECTION;
    // What the TIR band mirrors: the fire-lit interior.
    vec3 tirLight = (fireLight * 0.6 + innerRefl * 2.0) * tir;

    // ---- assemble ---------------------------------------------------------
    float T = 1.0 - F;   // enters the glass
    vec3 emission = fire.rgb + bloom + spark + bleed + innerRefl + tirLight;
    inside = F * lights + T * emission + warmRim + edgeLight;
    // Page visible through this pixel: via the body (attenuated, minus the
    // TIR band and the flame's own occlusion) and via ambient reflection.
    float throughBody = T * transmit * (1.0 - tir) * (1.0 - occlusion);
    throughIn = clamp(throughBody + reflectedPage, 0.0, 1.0);
  }

  // =====================================================================
  // Outside the pill: light leak at the silhouette and the floor glow
  // =====================================================================
  vec3 outside = vec3(0.0);
  float throughOut = 1.0;  // the page, minus the pill's contact shadow
  if (mask < 1.0) {
    // Light leaking through the edge into the air right beside it.
    vec2 edgeUv = clamp(fireUv, 0.0, 1.0);
    vec3 leak = texture(uBloom, edgeUv).rgb * uDecode * exp(-max(d, 0.0) * 9.0) * 0.22 * P_BLOOM;

    // Floor: a mirrored, compressed reflection of the fire below the pill,
    // fading quickly, plus a broad soft orange ambient pool.
    float below = max(-0.5 - p.y, 0.0);          // distance under the bottom edge
    vec2 mirror = vec2(p.x, -0.5 + below * 0.7);  // point inside the pill it reflects
    float mirrorD = pillSdf(mirror, halfW);       // fades the reflection past the ends
    // Three horizontal taps smear the reflection: the floor is glossy, not a mirror.
    vec2 mUv = mirror * fireUvScale + 0.5;
    vec2 mDx = vec2(0.07 * fireUvScale.x * (1.0 + below * 2.0), 0.0);
    vec3 floorRefl = (texture(uBloom, mUv).rgb * 0.5
                    + texture(uBloom, mUv + mDx).rgb * 0.25
                    + texture(uBloom, mUv - mDx).rgb * 0.25) * uDecode
                   * exp(-below * 4.0) * 0.32 * smoothstep(0.0, 0.03, below)
                   * (1.0 - smoothstep(-0.05, 0.12, mirrorD));
    // Ambient pool: average fire light along the base.
    vec3 avg = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      vec2 sp = vec2((float(i) - 2.0) * 0.4 * halfW, -0.4);
      avg += texture(uBloom, sp * fireUvScale + 0.5).rgb;
    }
    avg *= uDecode * 0.2;
    vec2 pf = vec2(p.x / (halfW + 0.05), below / 0.42);
    vec3 pool = avg * exp(-dot(pf, pf) * 2.4) * 0.09 * smoothstep(0.0, 0.05, below);
    outside = (leak + floorRefl + pool) * (1.0 + 0.35 * hover + 0.8 * uPulse) * P_BLOOM;
    // Contact shadow: a thick object resting on a surface darkens the
    // surface just beneath it. Modelled as a blurred copy of the pill
    // shifted down, strongest right under the bottom edge and fading with
    // distance. Invisible on black; on a light page it grounds the pill and
    // gives the glow something to tint.
    float shadowSdf = pillSdf(p - vec2(0.0, 0.10), halfW);
    float ao = 0.45 * (1.0 - smoothstep(-0.02, 0.42, shadowSdf)) * smoothstep(0.12, -0.08, fy);
    throughOut = 1.0 - ao;
    // Fade to nothing before the canvas edge so the glow never shows a hard
    // rectangular cut, whatever padding the element chose.
    vec2 edgePx = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy) / uPillSize.y;
    float edgeFade = smoothstep(0.0, 0.35, min(edgePx.x, edgePx.y));
    outside *= edgeFade;
    throughOut = 1.0 - ao * edgeFade;
  }

  // ---- combine ------------------------------------------------------------
  // The browser composites this premultiplied canvas in sRGB-encoded space:
  //   displayed = rgb + page_encoded * (1 - alpha).
  // Our light L is linear. The page term must therefore be expressed in
  // encoded space too, otherwise a body passing 17% of the page's light
  // would show 17% of its *encoded* value (about 3% of its light) and light
  // pages come out far too dark. Choosing alpha so that a white page gives
  // exactly encode(L + through) makes the blend right on white, identical to
  // before on black, and a sensible interpolation in between.
  vec3 Lin = aces(inside);
  vec3 Lout = aces(outside);
  vec3 encIn = linearToSrgb(Lin);
  vec3 encOut = linearToSrgb(Lout);
  float alphaIn = 1.0 - pageWeight(Lin, encIn, throughIn);
  float alphaOut = 1.0 - pageWeight(Lout, encOut, throughOut);
  vec3 rgb = encIn * mask + encOut * (1.0 - mask);
  float alpha = alphaIn * mask + alphaOut * (1.0 - mask);
  fragColor = vec4(rgb, alpha);
}
`;
