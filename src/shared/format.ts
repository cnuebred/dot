/**
 * Icon description format versioning (API v2). Decompressed payload has
 * the form `v<N>:<data>`, allowing future format versions to be introduced
 * without breaking backward compatibility of old links.
 */

/**
 * v8 uses BASE-36 (0-9+a-z) for every single-symbol field:
 *  - coordinates (0-35) → supports up to a 32×32 canvas (coords 0-31) plus
 *    positive overflow room (32-35)
 *  - weight / opacity / rotation / z-index / radius (0-35) → finer control
 * Legacy v3-v7 remain decodable (their 0-15 fields are rescaled to the
 * canonical 0-35 scale on decode so all renderers agree).
 */
export const FORMAT_VERSION = 8;
export const VERSION_PREFIX = `v${FORMAT_VERSION}:`;

export interface ParsedPayload {
  version: number;
  /** Canvas max coordinate for v8 (15=16×16, 31=32×32). Legacy defaults to 15. */
  size?: number;
  body: string;
}

const VERSION_REGEX = /^v(\d+):/;

/**
 * Splits version preamble from figure data.
 * Legacy formats: `v<N>:<body>`.
 * v8 adds an explicit canvas-size segment: `v8:<size>:<body>` so a stateless
 * 32×32 icon is self-describing when shared/reopened.
 */
export function stripVersion(text: string): ParsedPayload | null {
  const match = VERSION_REGEX.exec(text);
  if (!match) return null;

  const version = parseInt(match[1]!, 10);
  let body = text.slice(match[0].length);
  let size: number | undefined;

  if (version === 8) {
    // Consume the optional `<size>:` segment.
    const sizeMatch = /^(\d+):/.exec(body);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1]!, 10);
      body = body.slice(sizeMatch[0].length);
    }
  }

  return { version, size, body };
}

/** Prepends current version preamble to raw figure data (used by encoder). */
export function withVersion(body: string): string {
  return `${VERSION_PREFIX}${body}`;
}
