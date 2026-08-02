import * as fflate from 'fflate';

export interface DecodeResult {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Decodes payload from Base64URL -> Uint8Array -> DEFLATE -> String
 */
export function decodePayload(payload: string): DecodeResult {
  try {
    // Early reject: payload must not be empty or longer than 512 chars
    if (!payload || payload.length > 512) {
      return { success: false, error: 'Invalid payload length' };
    }

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    if (bytes.length > 10 * 1024) {
      return { success: false, error: 'Payload too large' };
    }

    const decompressed = fflate.unzlibSync(bytes);
    
    if (decompressed.length > 100 * 1024) {
      return { success: false, error: 'Decompressed data exceeds limit' };
    }

    const text = new TextDecoder().decode(decompressed);
    return { success: true, data: text };
  } catch (e) {
    return { 
      success: false, 
      error: e instanceof Error ? e.message : 'Unknown decoding error' 
    };
  }
}