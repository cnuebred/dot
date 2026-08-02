/**
 * Shared 64-color palette used by both backend (svgCompiler)
 * and frontend (Toolbar / LayerPanel). Color index is encoded as
 * 2 hex chars (00-3f) in the figure block, so the palette MUST have exactly 64 entries.
 */

export const PALETTE_SIZE = 64;

/** Maximum color index value that can be encoded (0-3f in hex). */
export const MAX_COLOR_INDEX = PALETTE_SIZE - 1;

function buildPalette(): string[] {
  const colors: string[] = [];

  // 8 grayscale shades (0-7): from black to white.
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 255);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }

  // 56 colors in full spectrum (8 shades × 7 base hues),
  // generated from HSL space for even color wheel coverage.
  const huesCount = 14;
  const shadesPerHue = 4;
  for (let h = 0; h < huesCount; h++) {
    for (let s = 0; s < shadesPerHue; s++) {
      const hue = Math.round((h / huesCount) * 360);
      const lightness = 35 + s * 12; // 35%, 47%, 59%, 71%
      colors.push(hslToHex(hue, 75, lightness));
    }
  }

  return colors.slice(0, PALETTE_SIZE);
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toByte = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export const PALETTE_64: readonly string[] = Object.freeze(buildPalette());

/** Returns CSS color for given index (0-63), with bounds protection. */
export function getColorByIndex(index: number): string {
  return PALETTE_64[index % PALETTE_SIZE]!;
}
