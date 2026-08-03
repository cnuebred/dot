/**
 * Multi-palette color system.
 * 
 * Color index is encoded as 8 bits (2 hex chars) in the figure block:
 *   - Upper 2 bits (bits 6-7): palette ID (0-3)
 *   - Lower 6 bits (bits 0-5): color index within palette (0-63)
 * 
 * This allows 4 distinct palettes × 64 colors = 256 total color slots,
 * while remaining fully backward-compatible (old payloads have paletteId=0).
 */

export const PALETTE_SIZE = 64;
export const PALETTE_COUNT = 16;
export const MAX_COLOR_INDEX = 4095; // 12-bit: paletteId<<6 | colorIndex

/** Bitmask to extract the 6-bit color index from a 12-bit color value. */
export const COLOR_INDEX_MASK = 0x3f;

/** Bitmask to extract the 4-bit palette ID from a 12-bit color value. */
export const PALETTE_ID_MASK = 0x0f;

/** Shift to extract the 4-bit palette ID from a 12-bit color value. */
export const PALETTE_SHIFT = 6;

export interface PaletteInfo {
  id: number;
  name: string;
  description: string;
}

export const PALETTE_META: readonly PaletteInfo[] = Object.freeze([
  { id: 0,  name: 'Vivid',      description: 'Default — bright, saturated colors for general use' },
  { id: 1,  name: 'Pastel',     description: 'Soft, muted pastel tones for gentle designs' },
  { id: 2,  name: 'Neon',       description: 'Fluorescent, high-contrast neon colors' },
  { id: 3,  name: 'Monochrome', description: 'Single-hue gradients (blue, sepia, green, purple)' },
  { id: 4,  name: 'Ocean',      description: 'Cool blue-cyan gradients for water and sky themes' },
  { id: 5,  name: 'Sunset',     description: 'Warm orange-pink gradients for dusk themes' },
  { id: 6,  name: 'Forest',     description: 'Deep green gradients for nature themes' },
  { id: 7,  name: 'Candy',      description: 'Bright playful colors for kids and fun designs' },
  { id: 8,  name: 'Retro',      description: 'Faded vintage tones with a nostalgic feel' },
  { id: 9,  name: 'Cyber',      description: 'Purple-magenta cyberpunk high-contrast colors' },
  { id: 10, name: 'Earth',      description: 'Natural browns, tans and warm neutrals' },
  { id: 11, name: 'Ice',        description: 'Frosty pale blues and whites for winter themes' },
  { id: 12, name: 'Fire',       description: 'Intense red-orange-yellow gradients' },
  { id: 13, name: 'Royal',      description: 'Deep rich jewel tones (sapphire, ruby, emerald)' },
  { id: 14, name: 'Mint',       description: 'Fresh green-teal pastels for clean designs' },
  { id: 15, name: 'Noir',       description: 'Black-white-gray scale with subtle blue tint' },
]);

// ---- Palette builders ----

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

/** Build palette 0: Vivid — the original 64-color palette. */
function buildVividPalette(): string[] {
  const colors: string[] = [];

  // 8 grayscale shades (0-7)
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 255);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }

  // 56 colors: 14 hues × 4 shades
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 35 + s * 12;
      colors.push(hslToHex(hue, 75, lightness));
    }
  }

  return colors;
}

/** Build palette 1: Pastel — soft, muted tones. */
function buildPastelPalette(): string[] {
  const colors: string[] = [];

  // 8 warm grays
  for (let i = 0; i < 8; i++) {
    const v = Math.round(180 + (i / 7) * 75);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }

  // 56 pastels: 14 hues × 4 shades, high lightness, low saturation
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 70 + s * 6; // 70-88%
      colors.push(hslToHex(hue, 40, lightness));
    }
  }

  return colors;
}

/** Build palette 2: Neon — fluorescent, high-saturation colors. */
function buildNeonPalette(): string[] {
  const colors: string[] = [];

  // 8 dark grays (backgrounds)
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 40);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }

  // 56 neon: 14 hues × 4 shades, max saturation, varied lightness
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 30 + s * 15; // 30-75%
      colors.push(hslToHex(hue, 100, lightness));
    }
  }

  return colors;
}

/** Build palette 3: Monochrome — 4 single-hue gradients (16 each). */
function buildMonochromePalette(): string[] {
  const colors: string[] = [];

  const hues = [210, 30, 120, 280]; // blue, sepia/orange, green, purple
  const stepsPerHue = 16;

  for (const hue of hues) {
    for (let i = 0; i < stepsPerHue; i++) {
      const lightness = 10 + i * 5; // 10-85%
      colors.push(hslToHex(hue, 60, lightness));
    }
  }

  return colors;
}

/** Build palette 4: Ocean — cool blue-cyan gradients. */
function buildOceanPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(20 + (i / 7) * 60);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(180 + (h / 14) * 60); // 180-240 (cyan→blue)
      const lightness = 25 + s * 15;
      colors.push(hslToHex(hue, 80, lightness));
    }
  }
  return colors;
}

/** Build palette 5: Sunset — warm orange-pink gradients. */
function buildSunsetPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(30 + (i / 7) * 70);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(10 + (h / 14) * 50); // 10-60 (orange→yellow)
      const lightness = 30 + s * 14;
      colors.push(hslToHex(hue, 90, lightness));
    }
  }
  return colors;
}

/** Build palette 6: Forest — deep green gradients. */
function buildForestPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(15 + (i / 7) * 50);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(90 + (h / 14) * 60); // 90-150 (green)
      const lightness = 20 + s * 15;
      colors.push(hslToHex(hue, 70, lightness));
    }
  }
  return colors;
}

/** Build palette 7: Candy — bright playful colors. */
function buildCandyPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(200 + (i / 7) * 55);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 55 + s * 9; // 55-82%
      colors.push(hslToHex(hue, 85, lightness));
    }
  }
  return colors;
}

/** Build palette 8: Retro — faded vintage tones. */
function buildRetroPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(90 + (i / 7) * 90);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 40 + s * 10;
      colors.push(hslToHex(hue, 35, lightness)); // low saturation = faded
    }
  }
  return colors;
}

/** Build palette 9: Cyber — purple-magenta cyberpunk colors. */
function buildCyberPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 30);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(260 + (h / 14) * 80); // 260-340 (purple→magenta)
      const lightness = 25 + s * 15;
      colors.push(hslToHex(hue, 95, lightness));
    }
  }
  return colors;
}

/** Build palette 10: Earth — natural browns and warm neutrals. */
function buildEarthPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(60 + (i / 7) * 100);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(20 + (h / 14) * 40); // 20-60 (brown→tan)
      const lightness = 25 + s * 13;
      colors.push(hslToHex(hue, 50, lightness));
    }
  }
  return colors;
}

/** Build palette 11: Ice — frosty pale blues and whites. */
function buildIcePalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(200 + (i / 7) * 55);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(190 + (h / 14) * 50); // 190-240 (ice blue)
      const lightness = 70 + s * 6; // 70-88%
      colors.push(hslToHex(hue, 45, lightness));
    }
  }
  return colors;
}

/** Build palette 12: Fire — intense red-orange-yellow gradients. */
function buildFirePalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 45);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 50); // 0-50 (red→yellow)
      const lightness = 25 + s * 15;
      colors.push(hslToHex(hue, 100, lightness));
    }
  }
  return colors;
}

/** Build palette 13: Royal — deep rich jewel tones. */
function buildRoyalPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(10 + (i / 7) * 45);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round((h / 14) * 360);
      const lightness = 20 + s * 13;
      colors.push(hslToHex(hue, 75, lightness));
    }
  }
  return colors;
}

/** Build palette 14: Mint — fresh green-teal pastels. */
function buildMintPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round(180 + (i / 7) * 75);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = Math.round(140 + (h / 14) * 60); // 140-200 (green→teal)
      const lightness = 60 + s * 8;
      colors.push(hslToHex(hue, 60, lightness));
    }
  }
  return colors;
}

/** Build palette 15: Noir — black-white-gray scale with subtle blue tint. */
function buildNoirPalette(): string[] {
  const colors: string[] = [];
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i / 7) * 255);
    const hex = v.toString(16).padStart(2, '0');
    colors.push(`#${hex}${hex}${hex}`);
  }
  for (let h = 0; h < 14; h++) {
    for (let s = 0; s < 4; s++) {
      const hue = 220; // subtle blue tint
      const lightness = 8 + s * 22; // 8-74%
      colors.push(hslToHex(hue, 12, lightness));
    }
  }
  return colors;
}

// ---- Exported palettes ----

const PALETTES: string[][] = [
  buildVividPalette(),
  buildPastelPalette(),
  buildNeonPalette(),
  buildMonochromePalette(),
  buildOceanPalette(),
  buildSunsetPalette(),
  buildForestPalette(),
  buildCandyPalette(),
  buildRetroPalette(),
  buildCyberPalette(),
  buildEarthPalette(),
  buildIcePalette(),
  buildFirePalette(),
  buildRoyalPalette(),
  buildMintPalette(),
  buildNoirPalette(),
];

/** All 16 palettes, each frozen. */
export const PALETTES_64: readonly (readonly string[])[] = Object.freeze(
  PALETTES.map(p => Object.freeze(p))
);

/** Default palette (Vivid) — kept for backward compatibility. */
export const PALETTE_64: readonly string[] = PALETTES_64[0]!;

// ---- Lookup helpers ----

/** Extract palette ID (0-15) from a 12-bit color value. */
export function getPaletteId(colorValue: number): number {
  return (colorValue >> PALETTE_SHIFT) & PALETTE_ID_MASK;
}

/** Extract color index (0-63) from an 8-bit color value. */
export function getColorIndex(colorValue: number): number {
  return colorValue & COLOR_INDEX_MASK;
}

/** Encode palette ID + color index into a single 12-bit value. */
export function encodeColor(paletteId: number, colorIndex: number): number {
  return ((paletteId & PALETTE_ID_MASK) << PALETTE_SHIFT) | (colorIndex & COLOR_INDEX_MASK);
}

/** Returns CSS color for given 8-bit color value, with bounds protection. */
export function getColorByIndex(colorValue: number): string {
  const paletteId = getPaletteId(colorValue);
  const idx = getColorIndex(colorValue);
  const palette = PALETTES_64[paletteId % PALETTE_COUNT]!;
  return palette[idx % PALETTE_SIZE]!;
}

/** Returns the full palette array for a given palette ID. */
export function getPalette(paletteId: number): readonly string[] {
  return PALETTES_64[paletteId % PALETTE_COUNT]!;
}
