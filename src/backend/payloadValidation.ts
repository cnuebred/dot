import { decodePayload } from './decoder';
import { validatePayload } from './validator';
import { stripVersion, FORMAT_VERSION } from '../shared/format';

/** Result of payload validation and decoding. */
export interface PayloadValidationResult {
  success: true;
  body: unknown;
  version: number;
  /** Canvas max coordinate for v8 (15/31); undefined for legacy. */
  size?: number;
}

export interface PayloadValidationError {
  success: false;
  error: string;
}

export type PayloadValidationOutcome = PayloadValidationResult | PayloadValidationError;

const PAYLOAD_CHAR_REGEX = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Validates and decodes an icon payload (Base64URL).
 * Used by gallery, staticLinks and potentially other modules.
 * Eliminates ~25 lines of duplication in each.
 */
export function validateAndDecodePayload(payload: unknown): PayloadValidationOutcome {
  if (typeof payload !== 'string' || !PAYLOAD_CHAR_REGEX.test(payload)) {
    return { success: false, error: 'Invalid payload format' };
  }

  const decodeResult = decodePayload(payload);
  if (!decodeResult.success || !decodeResult.data) {
    return { success: false, error: decodeResult.error || 'Failed to decode icon' };
  }

  const parsed = stripVersion(decodeResult.data);
  if (!parsed) {
    return { success: false, error: 'Missing format version preamble' };
  }
  // Accept v3..v8 (validator.ts handles all block formats)
  if (parsed.version < 3 || parsed.version > FORMAT_VERSION) {
    return { success: false, error: `Unsupported format version: v${parsed.version}` };
  }

  const validation = validatePayload(parsed.body, parsed.version);
  if (!validation.isValid) {
    return { success: false, error: validation.error || 'Invalid icon data' };
  }

  return { success: true, body: parsed.body, version: parsed.version, size: parsed.size };
}