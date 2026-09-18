/**
 * Status modes: a palette per status plus a few parameter presets.
 *
 * Colours are linear-light RGB. Fire ramp values above 1.0 are intentional
 * HDR: the composite pass tonemaps and the bloom pass picks them up. The
 * ramp runs edge -> low -> mid -> hot -> core from the cool fringe of a
 * tongue to its hottest centre. `rim` tints the glass edge light and side
 * reflections; `icon` is a CSS colour for the built-in icon.
 */
import type { Params } from './params';

export const STATUS_NAMES = ['healthy', 'warning', 'trouble', 'unknown'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

export type RGB = readonly [number, number, number];

export interface Palette {
  /** Fire temperature ramp, coolest to hottest. */
  fire: readonly [RGB, RGB, RGB, RGB, RGB];
  /** Tint of the glass edge light and side reflections. */
  rim: RGB;
  /** CSS colour for the built-in icon. */
  icon: string;
}

export interface StatusPreset {
  palette: Palette;
  /** Parameter nudges applied under explicit attributes. */
  params: Partial<Params>;
  /** Built-in icon key. */
  icon: 'check' | 'warning' | 'cross' | 'question';
  /** Screen-reader label for the status. */
  label: string;
}

/** The default look when no status is set: the original orange fire. */
export const DEFAULT_PALETTE: Palette = {
  fire: [
    [0.55, 0.015, 0.0],
    [1.1, 0.1, 0.0],
    [1.6, 0.42, 0.02],
    [2.4, 1.35, 0.25],
    [3.6, 3.1, 2.2],
  ],
  rim: [0.4, 0.65, 1.0],
  icon: '#ffb864',
};

export const STATUS_PRESETS: Readonly<Record<StatusName, StatusPreset>> = {
  healthy: {
    palette: {
      fire: [
        [0.0, 0.3, 0.02],
        [0.02, 0.85, 0.06],
        [0.14, 1.6, 0.14],
        [0.6, 2.4, 0.4],
        [2.2, 3.4, 2.0],
      ],
      rim: [0.3, 1.0, 0.42],
      icon: '#7df59a',
    },
    params: {},
    icon: 'check',
    label: 'healthy',
  },
  warning: {
    palette: {
      fire: [
        [0.6, 0.06, 0.0],
        [1.3, 0.2, 0.0],
        [1.9, 0.5, 0.02],
        [2.7, 1.15, 0.12],
        [3.5, 2.5, 1.2],
      ],
      rim: [1.0, 0.62, 0.22],
      icon: '#ffb340',
    },
    params: {},
    icon: 'warning',
    label: 'warning',
  },
  trouble: {
    palette: {
      fire: [
        [0.45, 0.0, 0.0],
        [1.2, 0.03, 0.0],
        [1.9, 0.12, 0.02],
        [2.6, 0.5, 0.2],
        [3.4, 1.8, 1.4],
      ],
      rim: [1.0, 0.26, 0.2],
      icon: '#ff6a5a',
    },
    params: {},
    icon: 'cross',
    label: 'trouble',
  },
  unknown: {
    palette: {
      fire: [
        [0.0, 0.04, 0.4],
        [0.02, 0.24, 1.0],
        [0.1, 0.6, 1.7],
        [0.5, 1.3, 2.5],
        [1.9, 2.6, 3.5],
      ],
      rim: [0.35, 0.62, 1.0],
      icon: '#66b8ff',
    },
    // Plasma rather than combustion: lower, smoother, more sparkle.
    params: { fireHeight: 0.85, turbulence: 1.3, emberDensity: 2.2, fireIntensity: 0.95 },
    icon: 'question',
    label: 'unknown',
  },
};

// ---------------------------------------------------------------- effects

export const EFFECT_NAMES = ['fire', 'water'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

/** Default palette for effect="water" when no status is set: deep teal to pale cyan. */
export const WATER_PALETTE: Palette = {
  fire: [
    [0.0, 0.05, 0.14],
    [0.0, 0.22, 0.55],
    [0.05, 0.6, 1.1],
    [0.45, 1.5, 2.1],
    [1.8, 2.8, 3.2],
  ],
  rim: [0.3, 0.75, 1.0],
  icon: '#5fd4ff',
};

export interface EffectPreset {
  /** Parameter nudges applied under the status preset and explicit attributes. */
  params: Partial<Params>;
}

/**
 * Effect presets. The parameter names keep their fire meaning in the API;
 * for water they map to: fireHeight -> water level, turbulence -> wave
 * amplitude, fireSpeed -> flow speed, emberDensity -> bubbles and sparkle,
 * fireIntensity -> brightness, heatDistortion -> surface shimmer.
 */
export const EFFECT_PRESETS: Readonly<Record<EffectName, EffectPreset>> = {
  fire: { params: {} },
  water: { params: {} },
};

export function isEffect(v: unknown): v is EffectName {
  return typeof v === 'string' && (EFFECT_NAMES as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is StatusName {
  return typeof v === 'string' && (STATUS_NAMES as readonly string[]).includes(v);
}

/** Flatten a palette into the 18 floats the renderer uploads (5 fire + rim). */
export function flattenPalette(p: Palette, out: Float32Array = new Float32Array(18)): Float32Array {
  for (let i = 0; i < 5; i++) {
    out[i * 3] = p.fire[i][0];
    out[i * 3 + 1] = p.fire[i][1];
    out[i * 3 + 2] = p.fire[i][2];
  }
  out[15] = p.rim[0];
  out[16] = p.rim[1];
  out[17] = p.rim[2];
  return out;
}

/** Built-in icons: 24-unit viewBox line icons, stroked in currentColor. */
export const ICONS: Record<StatusPreset['icon'], string> = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M8 12.2l2.6 2.6L16 9.6"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6 2.9 19.4h18.2L12 3.6z"/><path d="M12 9.4v4.6"/><circle cx="12" cy="16.6" r="0.6" fill="currentColor"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/></svg>',
  question:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><path d="M9.4 9.6a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 1.9"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>',
};
