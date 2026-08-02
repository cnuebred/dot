/**
 * Embeddable Web Component `<dot-icon>` for embedding dot.qrware.pl icons
 * on any third-party page. Loaded as a standalone script (dist/embed.js).
 *
 * Usage:
 *   <script src="https://dot.qrware.pl/embed.js"></script>
 *   <dot-icon payload="eJwzMChKSzNOAwAIRwI4" size="64"></dot-icon>
 *
 * Attributes:
 *   payload - encoded icon string (required)
 *   size    - size in px (default 64)
 *   origin  - overrides API domain (defaults to domain where embed.js was loaded)
 */
// Capture script origin at execution time (document.currentScript
// is only valid during synchronous script loading, not later).
const SCRIPT_ORIGIN = (() => {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    try {
      return new URL(script.src).origin;
    } catch {
      // ignore and use fallback
    }
  }
  return window.location.origin;
})();

class DotIconElement extends HTMLElement {
  static get observedAttributes() {
    return ['payload', 'size', 'origin'];
  }

  connectedCallback() {
    this.renderIcon();
  }

  attributeChangedCallback() {
    this.renderIcon();
  }

  private resolveOrigin(): string {
    return this.getAttribute('origin') ?? SCRIPT_ORIGIN;
  }

  private renderIcon() {
    const payload = this.getAttribute('payload') ?? '';
    const size = this.getAttribute('size') ?? '64';

    this.innerHTML = '';

    if (!payload) return;

    const img = document.createElement('img');
    img.src = `${this.resolveOrigin()}/r/${payload}`;
    img.width = Number(size) || 64;
    img.height = Number(size) || 64;
    img.alt = 'dot.qrware.pl icon';
    img.loading = 'lazy';
    img.style.display = 'inline-block';

    this.appendChild(img);
  }
}

if (!customElements.get('dot-icon')) {
  customElements.define('dot-icon', DotIconElement);
}
