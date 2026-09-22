import { describe, expect, it } from 'vitest';
import { parseIconSvg, splitArrow } from '../src/glyphs';
import { ICONS } from '../src/status';

describe('splitArrow', () => {
  it('strips a trailing arrow and reports it', () => {
    expect(splitArrow('Take Action →')).toEqual({ text: 'Take Action', arrow: true });
    expect(splitArrow('Dive In→')).toEqual({ text: 'Dive In', arrow: true });
  });
  it('leaves other text alone and collapses whitespace', () => {
    expect(splitArrow('  Healthy \n')).toEqual({ text: 'Healthy', arrow: false });
    expect(splitArrow('→ Back')).toEqual({ text: '→ Back', arrow: false });
  });
});

describe('parseIconSvg', () => {
  it('extracts circles and paths with their fill intent', () => {
    const cmds = parseIconSvg(ICONS.warning);
    expect(cmds.map((c) => c.kind)).toEqual(['path', 'path', 'circle']);
    expect(cmds[2]).toMatchObject({ kind: 'circle', fill: true, cx: 12, cy: 16.6 });
    expect(cmds[0].fill).toBe(false);
  });
  it('parses every built-in icon to at least two primitives', () => {
    for (const svg of Object.values(ICONS)) expect(parseIconSvg(svg).length).toBeGreaterThanOrEqual(2);
  });
});
