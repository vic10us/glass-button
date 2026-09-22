import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassButton } from '../src/glass-button';

// jsdom has no PointerEvent; the element only reads MouseEvent fields.
function pointer(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, ...init });
}

function mount(html = 'Take Action →'): GlassButton {
  const el = document.createElement('glass-button') as GlassButton;
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
  it('defines glass-button', () => {
    expect(customElements.get('glass-button')).toBe(GlassButton);
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
    el.level = 1.5;
    expect(el.getAttribute('level')).toBe('1.5');
    expect(el.level).toBe(1.5);
  });

  it('parses and clamps attribute writes', () => {
    const el = mount();
    el.setAttribute('bloom', '9');
    expect(el.bloom).toBe(3);
    el.setAttribute('bloom', 'garbage');
    expect(el.bloom).toBe(1);
  });

  it('reads attributes present before upgrade', () => {
    document.body.innerHTML = '<glass-button speed="2.5">Go</glass-button>';
    const el = document.querySelector('glass-button') as GlassButton;
    expect(el.speed).toBe(2.5);
  });

  it('exposes all parameters through the params object', () => {
    const el = mount();
    expect(Object.keys(el.params)).toHaveLength(11);
    el.params = { speed: 2 };
    expect(el.speed).toBe(2);
    expect(el.glassOpacity).toBe(0.86);
    expect(el.getAttribute('speed')).toBe('2');
  });

  it('exposes a defensive copy of the defaults', () => {
    const d = GlassButton.defaults;
    expect(d.glassOpacity).toBe(0.86);
    d.glassOpacity = 0;
    expect(GlassButton.defaults.glassOpacity).toBe(0.86);
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

describe('interaction', () => {
  it('marks the host pressed while the pointer is down and clears it on release', () => {
    const el = mount();
    const button = el.shadowRoot!.querySelector('button')!;
    button.dispatchEvent(pointer('pointerdown', { button: 0 }));
    expect(el.hasAttribute('data-pressed')).toBe(true);
    button.dispatchEvent(pointer('pointerup'));
    expect(el.hasAttribute('data-pressed')).toBe(false);
  });

  it('treats Space and Enter as a press while held', () => {
    const el = mount();
    const button = el.shadowRoot!.querySelector('button')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(el.hasAttribute('data-pressed')).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(el.hasAttribute('data-pressed')).toBe(false);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(el.hasAttribute('data-pressed')).toBe(true);
    button.dispatchEvent(new FocusEvent('blur'));
    expect(el.hasAttribute('data-pressed')).toBe(false);
  });

  it('ignores presses while disabled', () => {
    const el = mount();
    el.disabled = true;
    const button = el.shadowRoot!.querySelector('button')!;
    button.dispatchEvent(pointer('pointerdown', { button: 0 }));
    expect(el.hasAttribute('data-pressed')).toBe(false);
  });

  it('drops the pressed state when disabled mid-press', () => {
    const el = mount();
    const button = el.shadowRoot!.querySelector('button')!;
    button.dispatchEvent(pointer('pointerdown', { button: 0 }));
    el.disabled = true;
    expect(el.hasAttribute('data-pressed')).toBe(false);
  });
});

describe('reduced motion', () => {
  it('follows prefers-reduced-motion by default and can be overridden', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes('reduce'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const el = mount();
      expect(el.dataset.motion).toBe('reduced');
      el.reducedMotion = false;
      expect(el.dataset.motion).toBe('full');
      el.reducedMotion = 'auto';
      expect(el.dataset.motion).toBe('reduced');
    } finally {
      window.matchMedia = original;
    }
  });

  it('reports full motion when the query does not match', () => {
    const el = mount();
    expect(el.dataset.motion).toBe('full');
    el.reducedMotion = true;
    expect(el.dataset.motion).toBe('reduced');
  });
});

describe('lifecycle', () => {
  it('stops listening for visibility changes after disconnect', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const el = mount();
    expect(add).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    el.remove();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

describe('status', () => {
  it('has no status by default and renders no icon or status text', () => {
    const el = mount();
    expect(el.status).toBeNull();
    const root = el.shadowRoot!;
    expect(root.querySelector('.icon svg')).toBeNull();
    expect(root.querySelector('.sr-status')!.textContent).toBe('');
  });

  it('reflects status between attribute and property and renders the matching icon', () => {
    const el = mount('Server A');
    el.status = 'healthy';
    expect(el.getAttribute('status')).toBe('healthy');
    const root = el.shadowRoot!;
    expect(root.querySelector('.icon svg')).not.toBeNull();
    expect(root.querySelector('.sr-status')!.textContent).toBe('Status: healthy');
    el.setAttribute('status', 'trouble');
    expect(el.status).toBe('trouble');
    expect(root.querySelector('.icon svg path')!.getAttribute('d')).toContain('8.8');
  });

  it('ignores invalid statuses', () => {
    const el = mount();
    el.setAttribute('status', 'bogus');
    expect(el.status).toBeNull();
    expect(el.shadowRoot!.querySelector('.icon svg')).toBeNull();
  });

  it('fires statuschange with old and new values', () => {
    const el = mount();
    const events: Array<{ oldStatus: string | null; newStatus: string | null }> = [];
    el.addEventListener('statuschange', (e) => events.push((e as CustomEvent).detail));
    el.status = 'warning';
    el.status = 'unknown';
    el.status = null;
    expect(events).toEqual([
      { oldStatus: null, newStatus: 'warning' },
      { oldStatus: 'warning', newStatus: 'unknown' },
      { oldStatus: 'unknown', newStatus: null },
    ]);
  });

  it('applies preset parameter nudges under explicit attributes', () => {
    const el = mount();
    el.status = 'unknown';
    expect(el.level).toBeCloseTo(0.85);
    el.level = 1.5;
    expect(el.level).toBe(1.5);
    el.status = 'healthy';
    expect(el.level).toBe(1.5);
    el.removeAttribute('level');
    expect(el.level).toBe(1);
  });

  it('hides the icon with icon="none" and exposes the icon colour', () => {
    const el = mount();
    el.status = 'healthy';
    const root = el.shadowRoot!;
    expect(root.querySelector('.icon')!.hasAttribute('hidden')).toBe(false);
    el.setAttribute('icon', 'none');
    expect(root.querySelector('.icon')!.hasAttribute('hidden')).toBe(true);
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#7df59a');
  });

  it('accepts a custom palette', () => {
    const el = mount();
    el.palette = { ramp: [[0, 0, 0.3], [0, 0, 1], [0.2, 0.3, 1.5], [0.6, 0.8, 2], [2, 2, 3]], rim: [0.5, 0.5, 1], icon: '#8080ff' };
    expect(el.palette?.icon).toBe('#8080ff');
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#8080ff');
    el.palette = null;
    expect(el.palette).toBeNull();
  });
});

describe('effect', () => {
  it('defaults to fire and reflects between attribute and property', () => {
    const el = mount();
    expect(el.effect).toBe('fire');
    el.effect = 'water';
    expect(el.getAttribute('effect')).toBe('water');
    el.setAttribute('effect', 'fire');
    expect(el.effect).toBe('fire');
  });

  it('falls back to fire for unknown effects', () => {
    const el = mount();
    el.setAttribute('effect', 'lava');
    expect(el.effect).toBe('fire');
  });

  it('uses the aqua palette for water without a status, and the status palette with one', () => {
    const el = mount();
    el.effect = 'water';
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#5fd4ff');
    el.status = 'healthy';
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#7df59a');
    el.status = null;
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#5fd4ff');
    el.effect = 'fire';
    expect(el.style.getPropertyValue('--gb-icon-color')).toBe('#ffb864');
  });
});

describe('palette CSS variables (drive the CSS fallback)', () => {
  it('publishes tonemapped ramp and rim colours and updates them with status', () => {
    const el = mount();
    const before = el.style.getPropertyValue('--gb-fx-mid');
    expect(before).toMatch(/^#[0-9a-f]{6}$/);
    expect(el.style.getPropertyValue('--gb-fx-rim')).toMatch(/^#[0-9a-f]{6}$/);
    el.status = 'healthy';
    const after = el.style.getPropertyValue('--gb-fx-mid');
    expect(after).not.toBe(before);
    // Healthy is green: G dominates.
    const [r, g, b] = [after.slice(1, 3), after.slice(3, 5), after.slice(5, 7)].map((h) => parseInt(h, 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});
