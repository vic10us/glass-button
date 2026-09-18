import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FireGlassButton } from '../src/fire-glass-button';

function mount(html = 'Take Action →'): FireGlassButton {
  const el = document.createElement('fire-glass-button') as FireGlassButton;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  // jsdom has no WebGL; its getContext() stub logs "not implemented". Keep the output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('defines fire-glass-button', () => {
    expect(customElements.get('fire-glass-button')).toBe(FireGlassButton);
  });
});

describe('shadow DOM', () => {
  it('renders a real button with a slot for the label above an aria-hidden canvas', () => {
    const el = mount();
    const root = el.shadowRoot!;
    const button = root.querySelector('button')!;
    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('part')).toBe('button');
    expect(button.querySelector('slot')).not.toBeNull();
    const canvas = root.querySelector('canvas')!;
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    // Canvas must come before the button so the button (and its text) paints on top.
    expect(canvas.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('falls back to the CSS renderer when WebGL2 is unavailable', () => {
    const el = mount();
    expect(el.renderer).toBe('css');
    expect(el.dataset.renderer).toBe('css');
  });
});

describe('parameters', () => {
  it('reflects property writes to attributes', () => {
    const el = mount();
    el.fireHeight = 1.5;
    expect(el.getAttribute('fire-height')).toBe('1.5');
    expect(el.fireHeight).toBe(1.5);
  });

  it('parses and clamps attribute writes', () => {
    const el = mount();
    el.setAttribute('bloom-strength', '9');
    expect(el.bloomStrength).toBe(3);
    el.setAttribute('bloom-strength', 'garbage');
    expect(el.bloomStrength).toBe(1);
  });

  it('reads attributes present before upgrade', () => {
    document.body.innerHTML = '<fire-glass-button fire-speed="2.5">Go</fire-glass-button>';
    const el = document.querySelector('fire-glass-button') as FireGlassButton;
    expect(el.fireSpeed).toBe(2.5);
  });

  it('exposes all parameters through the params object', () => {
    const el = mount();
    expect(Object.keys(el.params)).toHaveLength(11);
    el.params = { fireSpeed: 2 };
    expect(el.fireSpeed).toBe(2);
    expect(el.glassOpacity).toBe(0.82);
    expect(el.getAttribute('fire-speed')).toBe('2');
  });

  it('exposes a defensive copy of the defaults', () => {
    const d = FireGlassButton.defaults;
    expect(d.glassOpacity).toBe(0.82);
    d.glassOpacity = 0;
    expect(FireGlassButton.defaults.glassOpacity).toBe(0.82);
  });
});

describe('accessibility', () => {
  it('mirrors disabled onto the inner button', () => {
    const el = mount();
    const button = el.shadowRoot!.querySelector('button')!;
    expect(button.disabled).toBe(false);
    el.setAttribute('disabled', '');
    expect(button.disabled).toBe(true);
    expect(el.disabled).toBe(true);
    el.disabled = false;
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it('dispatches a click from the host when the inner button is activated', () => {
    const el = mount();
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    el.shadowRoot!.querySelector('button')!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
