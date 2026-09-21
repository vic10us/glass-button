/**
 * Tunable visual parameters.
 *
 * Every parameter is a plain number exposed three ways: as a kebab-case
 * attribute, as a camelCase property on the element, and packed into the
 * `uParams` uniform array in PARAM_DEFS order (see renderer.ts). Keeping the
 * table here as the single source of truth means adding a parameter is one
 * row plus one line of shader.
 */

export type ParamName =
  | 'intensity'
  | 'level'
  | 'turbulence'
  | 'speed'
  | 'glassOpacity'
  | 'glassThickness'
  | 'refraction'
  | 'bloom'
  | 'reflection'
  | 'particles'
  | 'shimmer';

export type Params = Record<ParamName, number>;

export interface ParamDef {
  name: ParamName;
  attr: string;
  /** Default value, tuned against reference_image.png. */
  def: number;
  min: number;
  max: number;
  /** Short description for the demo tuning panel. */
  label: string;
}

/** Order matters: the renderer packs these into `uParams` in this order. */
export const PARAM_DEFS: readonly ParamDef[] = [
  { name: 'intensity', attr: 'intensity', def: 1, min: 0, max: 3, label: 'Effect brightness and density' },
  { name: 'level', attr: 'level', def: 1, min: 0, max: 2.5, label: 'How high the effect reaches: flame height or water level' },
  { name: 'turbulence', attr: 'turbulence', def: 1, min: 0, max: 3, label: 'Turbulence: curl of the flames or wave amplitude' },
  { name: 'speed', attr: 'speed', def: 1, min: 0, max: 4, label: 'Time scale of the effect' },
  { name: 'glassOpacity', attr: 'glass-opacity', def: 0.86, min: 0, max: 1, label: 'Darkness of the glass body' },
  { name: 'glassThickness', attr: 'glass-thickness', def: 1, min: 0.2, max: 3, label: 'Curvature and width of the edge zone' },
  { name: 'refraction', attr: 'refraction', def: 1, min: 0, max: 3, label: 'Distortion of the effect through the curved edge' },
  { name: 'bloom', attr: 'bloom', def: 1, min: 0, max: 3, label: 'Bloom and light leak' },
  { name: 'reflection', attr: 'reflection', def: 1, min: 0, max: 3, label: 'Fresnel and environment reflection' },
  { name: 'particles', attr: 'particles', def: 1, min: 0, max: 4, label: 'Particle count: embers or bubbles' },
  { name: 'shimmer', attr: 'shimmer', def: 1, min: 0, max: 3, label: 'Shimmer: heat haze or ripple detail' },
];

/** Attribute names, suitable for `observedAttributes`. */
export const PARAM_ATTRS: string[] = PARAM_DEFS.map((p) => p.attr);

const BY_ATTR = new Map(PARAM_DEFS.map((p) => [p.attr, p] as const));

export function defaults(): Params {
  const out = {} as Params;
  for (const p of PARAM_DEFS) out[p.name] = p.def;
  return out;
}

export function attrToParam(attr: string): ParamDef | undefined {
  return BY_ATTR.get(attr);
}

/**
 * Parse a raw attribute/property value. Anything that is not a finite number
 * falls back to the default; finite numbers are clamped to the documented
 * range so a typo can never produce a shader-breaking value.
 */
export function parseParam(def: ParamDef, raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return def.def;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return def.def;
  return Math.min(def.max, Math.max(def.min, n));
}
