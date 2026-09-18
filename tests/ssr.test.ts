// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * Server-side rendering: frameworks import component modules on the server.
 * The module must load without `document`, `HTMLElement` or `customElements`
 * and simply skip registration; the browser bundle upgrades the tag later.
 */
describe('import without a DOM', () => {
  it('loads and exports the class without touching the DOM', async () => {
    expect(typeof document).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
    const mod = await import('../src/glass-button');
    expect(typeof mod.GlassButton).toBe('function');
    expect(mod.STATUS_NAMES).toContain('healthy');
    expect(mod.GlassButton.defaults.glassOpacity).toBe(0.82);
  });
});
