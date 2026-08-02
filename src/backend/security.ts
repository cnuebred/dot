/**
 * OWASP security headers applied to all server responses.
 * `/r/:payload` (SVG images) uses a separate, lighter set because
 * it must remain hotlinkable (cross-origin <img>) from other domains.
 */

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  'X-XSS-Protection': '0', // deprecated, but explicitly disabled to avoid false positives in old browsers
};

/** Headers for HTML/app pages (strong CSP, iframe embedding blocked). */
export function getPageSecurityHeaders(): Record<string, string> {
  return {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/** Headers for generated SVG icons - intentionally looser to allow hotlinking/embedding. */
export function getAssetSecurityHeaders(): Record<string, string> {
  return {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
  };
}

/** Headers for JSON API responses (gallery etc.) – with CORS for external apps. */
export function getApiSecurityHeaders(): Record<string, string> {
  return {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'",
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function withHeaders(base: Record<string, string>, extra?: Record<string, string>): HeadersInit {
  return extra ? { ...base, ...extra } : base;
}
