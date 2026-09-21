import { describe, expect, it } from 'vitest';
import { PARAM_ATTRS, PARAM_DEFS, attrToParam, defaults, parseParam } from '../src/params';

describe('params', () => {
  it('exposes eleven parameters with the documented defaults', () => {
    const d = defaults();
    expect(Object.keys(d)).toHaveLength(11);
    expect(PARAM_ATTRS).toHaveLength(11);
    expect(d.glassOpacity).toBe(0.86);
    expect(d.intensity).toBe(1);
  });

  it('returns a fresh object from defaults()', () => {
    const a = defaults();
    a.level = 42;
    expect(defaults().level).not.toBe(42);
  });

  it('maps kebab-case attributes to camelCase names', () => {
    expect(attrToParam('level')?.name).toBe('level');
    expect(attrToParam('refraction')?.name).toBe('refraction');
    expect(attrToParam('nope')).toBeUndefined();
  });

  it('falls back to the default for unparseable input', () => {
    const def = PARAM_DEFS.find((p) => p.name === 'turbulence')!;
    expect(parseParam(def, 'abc')).toBe(def.def);
    expect(parseParam(def, null)).toBe(def.def);
    expect(parseParam(def, undefined)).toBe(def.def);
    expect(parseParam(def, '')).toBe(def.def);
  });

  it('clamps to the documented range', () => {
    const def = PARAM_DEFS.find((p) => p.name === 'bloom')!;
    expect(parseParam(def, '99')).toBe(def.max);
    expect(parseParam(def, '-1')).toBe(def.min);
    expect(parseParam(def, 1.5)).toBe(1.5);
    expect(parseParam(def, '0.25')).toBe(0.25);
  });
});
