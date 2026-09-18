import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, ICONS, STATUS_NAMES, STATUS_PRESETS, flattenPalette, isStatus } from '../src/status';

describe('status table', () => {
  it('defines the four statuses with palettes, icons and labels', () => {
    expect(STATUS_NAMES).toEqual(['healthy', 'warning', 'trouble', 'unknown']);
    for (const name of STATUS_NAMES) {
      const preset = STATUS_PRESETS[name];
      expect(preset.palette.ramp).toHaveLength(5);
      expect(ICONS[preset.icon]).toContain('<svg');
      expect(preset.label).toBe(name);
    }
  });

  it('recognises valid status names only', () => {
    expect(isStatus('healthy')).toBe(true);
    expect(isStatus('ok')).toBe(false);
    expect(isStatus(null)).toBe(false);
  });

  it('flattens a palette into 18 floats, fire ramp first then rim', () => {
    const flat = flattenPalette(DEFAULT_PALETTE);
    expect(flat).toHaveLength(18);
    expect(flat[0]).toBeCloseTo(DEFAULT_PALETTE.ramp[0][0]);
    expect(flat[14]).toBeCloseTo(DEFAULT_PALETTE.ramp[4][2]);
    expect(flat[15]).toBeCloseTo(DEFAULT_PALETTE.rim[0]);
  });
});
