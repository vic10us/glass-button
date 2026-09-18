export class FireGlassButton extends HTMLElement {}

if (!customElements.get('fire-glass-button')) {
  customElements.define('fire-glass-button', FireGlassButton);
}
