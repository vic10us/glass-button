/**
 * Glyph mask for the engraved label.
 *
 * The composite shader needs to know, per pixel, whether it is inside a
 * letter, so the label is rasterised into a coverage mask (white glyphs on
 * transparent) at device resolution. The mask covers the whole button so it
 * maps 1:1 onto the pill in the shader. Placement follows the live DOM: the
 * element measures where its (transparent) text and icon actually sit and
 * passes those boxes here, so layout stays the browser's job and the mask
 * merely traces it.
 *
 * Also draws a purpose-made arrow in place of a trailing "→": a shaft and
 * chevron proportioned to the font's x-height rather than whatever the
 * fallback font happens to ship.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlyphLayout {
  /** Button size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  /** Label text and the box its text node occupies (CSS px, button-relative). */
  text: string;
  textBox: Box | null;
  /** CSS font shorthand and resolved letter-spacing (px) of the label. */
  font: string;
  letterSpacing: number;
  /** Built-in icon markup (see status.ts) and its box, if shown. */
  iconSvg: string | null;
  iconBox: Box | null;
}

const ARROW_CHARS = /\s*[→➔➜⟶]\s*$/u;

/** Draw stroke/fill primitives parsed from one of the built-in icon SVGs. */
export interface IconCommand {
  kind: 'circle' | 'path';
  fill: boolean;
  cx?: number;
  cy?: number;
  r?: number;
  d?: string;
}

/** Parse the minimal SVG subset used by the built-in icons (24-unit viewBox). */
export function parseIconSvg(svg: string): IconCommand[] {
  const out: IconCommand[] = [];
  const tagRe = /<(circle|path)\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(svg))) {
    const attrs = m[2];
    const get = (name: string) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
      return a ? a[1] : undefined;
    };
    const fill = get('fill') !== undefined && get('fill') !== 'none';
    if (m[1] === 'circle') {
      out.push({ kind: 'circle', fill, cx: Number(get('cx')), cy: Number(get('cy')), r: Number(get('r')) });
    } else {
      const d = get('d');
      if (d) out.push({ kind: 'path', fill, d });
    }
  }
  return out;
}

/** Whether the label ends in an arrow we replace with the drawn one. */
export function splitArrow(text: string): { text: string; arrow: boolean } {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (ARROW_CHARS.test(trimmed)) return { text: trimmed.replace(ARROW_CHARS, ''), arrow: true };
  return { text: trimmed, arrow: false };
}

/**
 * Rasterise the label. Returns null when there is nothing to draw or the
 * environment has no 2D canvas (server, jsdom).
 */
export function renderGlyphMask(layout: GlyphLayout): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const { width, height, dpr } = layout;
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drewSomething = false;

  // ---- text (and arrow) ---------------------------------------------------
  const { text, arrow } = splitArrow(layout.text);
  if (layout.textBox && (text || arrow)) {
    const box = layout.textBox;
    ctx.font = layout.font;
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${layout.letterSpacing}px`;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(text);
    const fontPx = parseFontSize(layout.font);
    const ascent = metrics.fontBoundingBoxAscent || fontPx * 0.78;
    const descent = metrics.fontBoundingBoxDescent || fontPx * 0.22;
    // Baseline placed so the font's line box is vertically centred on the DOM box.
    const baseline = box.y + (box.h - (ascent + descent)) / 2 + ascent;
    const textW = text ? metrics.width : 0;
    const gap = arrow && text ? fontPx * 0.34 : 0;
    const arrowLen = arrow ? fontPx * 0.72 : 0;
    const total = textW + gap + arrowLen;
    const startX = box.x + (box.w - total) / 2;
    if (text) {
      ctx.fillText(text, startX, baseline);
      drewSomething = true;
    }
    if (arrow) {
      drawArrow(ctx, startX + textW + gap, baseline - fontPx * 0.31, arrowLen, fontPx);
      drewSomething = true;
    }
  }

  // ---- icon -----------------------------------------------------------------
  if (layout.iconSvg && layout.iconBox && layout.iconBox.w > 0) {
    const b = layout.iconBox;
    const scale = Math.min(b.w, b.h) / 24;
    ctx.save();
    ctx.translate(b.x + (b.w - 24 * scale) / 2, b.y + (b.h - 24 * scale) / 2);
    ctx.scale(scale, scale);
    ctx.lineWidth = 1.8;
    for (const cmd of parseIconSvg(layout.iconSvg)) {
      if (cmd.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(cmd.cx!, cmd.cy!, cmd.r!, 0, Math.PI * 2);
        if (cmd.fill) ctx.fill();
        else ctx.stroke();
      } else if (cmd.d) {
        const path = new Path2D(cmd.d);
        if (cmd.fill) ctx.fill(path);
        else ctx.stroke(path);
      }
    }
    ctx.restore();
    drewSomething = true;
  }

  return drewSomething ? canvas : null;
}

/** Shaft plus open chevron, stroke weight tied to the font size. */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, fontPx: number): void {
  const w = fontPx * 0.085;
  const head = fontPx * 0.26;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len - w * 0.5, y);
  ctx.moveTo(x + len - head, y - head);
  ctx.lineTo(x + len, y);
  ctx.lineTo(x + len - head, y + head);
  ctx.stroke();
}

function parseFontSize(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 16;
}
