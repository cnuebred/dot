/**
 * Icon description format versioning (API v2). Decompressed payload has
 * the form `v<N>:<data>`, allowing future format versions to be introduced
 * without breaking backward compatibility of old links.
 */

export const FORMAT_VERSION = 7;
export const VERSION_PREFIX = `v${FORMAT_VERSION}:`;

export interface ParsedPayload {
  version: number;
  body: string;
}

const VERSION_REGEX = /^v(\d+):/;

/** Splits version preamble (`v2:`) from actual figure data. */
export function stripVersion(text: string): ParsedPayload | null {
  const match = VERSION_REGEX.exec(text);
  if (!match) return null;

  return {
    version: parseInt(match[1]!, 10),
    body: text.slice(match[0].length),
  };
}

/** Prepends current version preamble to raw figure data (used by encoder). */
export function withVersion(body: string): string {
  return `${VERSION_PREFIX}${body}`;
}
