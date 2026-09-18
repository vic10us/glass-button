import { describe, expect, it } from 'vitest';
import '../src/fire-glass-button';

describe('registration', () => {
  it('defines fire-glass-button', () => {
    expect(customElements.get('fire-glass-button')).toBeDefined();
  });
});
