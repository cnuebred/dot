import { compileToSvg } from './svgCompiler';
import { getFallbackSvg } from './fallbackSvg';
import { FORMAT_VERSION, stripVersion } from '../shared/format';
import { validateAndDecodePayload } from './payloadValidation';
import { validatePayload } from './validator';
import { getPageSecurityHeaders, getAssetSecurityHeaders, getApiSecurityHeaders } from './security';
import { rateLimiter, getClientIp } from './rateLimiter';
import { renderCache, RenderCache } from './renderCache';
import { tryRedisGet, redisSet, redisCacheEnabled } from './redisCache';
import { resolveTier, batchLimits, staticLinkQuota, limitsDisabled } from './apiKeys';
import { sqliteEnabled } from './sqliteStore';
import { listGalleryEntries, addGalleryEntry } from './gallery';
import { createStaticLink, getLinkByPublicId, getLinkByOwnerId, updateStaticLink } from './staticLinks';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const PORT = Number(process.env.PORT) || 3250;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`;

// Built frontend (result of `bun run build` / vite build) served statically.
const DIST_DIR = new URL('../../dist', import.meta.url).pathname;

const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  json: 'application/json',
};

const PAYLOAD_CHAR_REGEX = /^[A-Za-z0-9_-]{1,512}$/;

const FALLBACK_HEADERS = { 'Content-Type': 'image/svg+xml', ...getAssetSecurityHeaders() };

/** Wraps a Promise with a timeout – throws after `ms` milliseconds. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

// --- Server metrics ---
const serverStartTime = Date.now();
const metrics = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  totalRenderMs: 0,
  renderCount: 0,
};

export function recordRenderTime(ms: number): void {
  metrics.totalRenderMs += ms;
  metrics.renderCount++;
}

function fallbackResponse(): Response {
  return new Response(getFallbackSvg(), { status: 400, headers: FALLBACK_HEADERS });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getApiSecurityHeaders() },
  });
}

// Max JSON body size for POST/PUT endpoints (defense against memory DoS).
const MAX_JSON_BODY_BYTES = 256 * 1024; // 256 KB

/**
 * Reads and parses a JSON request body with a hard size limit.
 * Returns null on invalid JSON, oversized body, or a non-JSON content type.
 */
async function readJsonBody<T = any>(req: Request): Promise<T | null> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_JSON_BODY_BYTES) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BODY_BYTES) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Compiles payload (Base64URL) to SVG, returns null if data is invalid. */
function renderIcon(payload: string, faviconBackground?: string, isPreview?: boolean): string | null {
  const result = validateAndDecodePayload(payload);
  if (!result.success) return null;
  return compileToSvg(result.body as string, { faviconBackground, isPreview });
}

/** Simple HTML special character escaping for safely embedding payloads in attributes/text. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

Bun.serve({
  port: PORT,
  // Defense-in-depth: hard cap on request body size (backed by readJsonBody's
  // 256 KB check on JSON endpoints). Returns 413 automatically.
  maxRequestBodySize: 512 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const ip = getClientIp(req, server);

    // --- Routing: /favicon/:payload (multi-size ICO) ---
    if (path.startsWith('/favicon/')) {
      const rate = await rateLimiter.check(`favicon:${ip}`, { limit: 100, windowMs: 60_000 });
      if (rate.limited) {
        metrics.rateLimited++;
        return new Response('Too Many Requests', { status: 429, headers: getApiSecurityHeaders() });
      }

      const payload = path.split('/')[2];
      if (!payload) return fallbackResponse();

      const faviconBg = url.searchParams.get('bg') || '#0a0a0c';

      // Check cache (key: payload + faviconBg, format=ico)
      const cacheKey = RenderCache.buildKey(payload, 'ico', faviconBg);
      let cached = renderCache.get(cacheKey);
      // Local miss → try shared Redis tier (multi-machine).
      if (!cached) {
        await tryRedisGet(renderCache, cacheKey);
        cached = renderCache.get(cacheKey);
      }
      if (cached?.icoBuffer) {
        return new Response(cached.icoBuffer as unknown as BodyInit, {
          headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...getAssetSecurityHeaders(),
          },
        });
      }

      const sizes = [16, 32, 48];

      try {
        const startTime = Date.now();
        const svg = renderIcon(payload, faviconBg);
        if (!svg) return fallbackResponse();

        // Generate PNG buffers for each size
        const pngBuffers = await Promise.all(
          sizes.map((size) =>
            withTimeout(
              sharp(Buffer.from(svg))
                .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer(),
              5000,
              `sharp favicon ${size}px`
            )
          )
        );

        // Pack into ICO
        const icoBuffer = await withTimeout(pngToIco(pngBuffers), 3000, 'pngToIco');

        const elapsed = Date.now() - startTime;
        recordRenderTime(elapsed);

        // Save to cache
        renderCache.set(cacheKey, { svg, icoBuffer, createdAt: Date.now() });
        await redisSet(renderCache, cacheKey);

        return new Response(icoBuffer as unknown as BodyInit, {
          headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...getAssetSecurityHeaders(),
          },
        });
      } catch (e) {
        console.error(`[Backend Error] favicon: ${e instanceof Error ? e.message : String(e)}`);
        return fallbackResponse();
      }
    }

    // --- Routing: /r/:payload (generated SVG image) ---
    if (path.startsWith('/r/')) {
      const rate = await rateLimiter.check(`img:${ip}`, { limit: 500, windowMs: 60_000 });
      if (rate.limited) {
        metrics.rateLimited++;
        return new Response('Too Many Requests', { status: 429, headers: getApiSecurityHeaders() });
      }

      const payload = path.split('/')[2];
      if (!payload) return fallbackResponse();

      const faviconMode = url.searchParams.get('mode') === 'favicon' || url.searchParams.has('favicon');
      const previewMode = url.searchParams.get('mode') === 'preview' || url.searchParams.has('preview');
      const faviconBg = faviconMode ? (url.searchParams.get('bg') || '#0a0a0c') : undefined;
      const format = (
        url.searchParams.get('format') || 
        url.searchParams.get('type') || 
        (url.searchParams.has('png') ? 'png' : null) || 
        (url.searchParams.has('webp') ? 'webp' : 'svg')
      ).toLowerCase();

      // Bitmap conversion (png/webp/ico via sharp) is far more CPU-heavy than
      // pure SVG. Apply a stricter, separate rate limit so a burst of bitmap
      // requests can't exhaust CPU even though the SVG limit is generous.
      const isBitmap = format === 'png' || format === 'webp' || faviconMode;
      if (isBitmap) {
        const bitmapRate = await rateLimiter.check(`img-bitmap:${ip}`, { limit: 60, windowMs: 60_000 });
        if (bitmapRate.limited) {
          metrics.rateLimited++;
          return new Response('Too Many Requests', { status: 429, headers: getApiSecurityHeaders() });
        }
      }

      const cacheKey = RenderCache.buildKey(payload, format, faviconBg, previewMode);

      // Strong ETag derived from the render-determining parameters.
      const etag = `"${cacheKey}"`;

      // 304 Not Modified – let clients revalidate without re-rendering.
      if (req.headers.get('if-none-match') === etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, ...getAssetSecurityHeaders() },
        });
      }

      let cached = renderCache.get(cacheKey);

      // Local miss → try the shared Redis tier (multi-machine).
      if (!cached) {
        await tryRedisGet(renderCache, cacheKey);
        cached = renderCache.get(cacheKey);
      }

      if (cached) {
        // Cache hit – return cached result
        let body: BodyInit;
        let contentType: string;

        if (format === 'png' && cached.pngBuffer) {
          body = cached.pngBuffer as unknown as BodyInit;
          contentType = 'image/png';
        } else if (format === 'webp' && cached.webpBuffer) {
          body = cached.webpBuffer as unknown as BodyInit;
          contentType = 'image/webp';
        } else {
          body = cached.svg;
          contentType = 'image/svg+xml';
        }

        return new Response(body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: etag,
            ...getAssetSecurityHeaders(),
          },
        });
      }
      
       try {
        const startTime = Date.now();
        const svg = renderIcon(payload, faviconBg, previewMode);
        if (!svg) return fallbackResponse();

        // Use BodyInit type accepted by Response
        let body: BodyInit = svg;
        let contentType = 'image/svg+xml';

        // Prepare cache entry
        const cacheEntry: { svg: string; pngBuffer?: Buffer; webpBuffer?: Buffer; createdAt: number } = {
          svg,
          createdAt: Date.now(),
        };

        if (format === 'png') {
          const buffer = await withTimeout(
            sharp(Buffer.from(svg)).png().toBuffer(),
            5000,
            'sharp png'
          );
          body = buffer as unknown as BodyInit;
          contentType = 'image/png';
          cacheEntry.pngBuffer = buffer;
        } else if (format === 'webp') {
          const buffer = await withTimeout(
            sharp(Buffer.from(svg)).webp().toBuffer(),
            5000,
            'sharp webp'
          );
          body = buffer as unknown as BodyInit;
          contentType = 'image/webp';
          cacheEntry.webpBuffer = buffer;
        }

        renderCache.set(cacheKey, cacheEntry);
        await redisSet(renderCache, cacheKey);

        const elapsed = Date.now() - startTime;
        recordRenderTime(elapsed);

        return new Response(body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: etag,
            ...getAssetSecurityHeaders(),
          },
        });
      } catch (e) {
        console.error(`[Backend Error] ${e instanceof Error ? e.message : String(e)}`);
        return fallbackResponse();
      }
    }

    // --- Routing: /raw/:payload (uncompressed link – developer/preview mode) ---
    if (path.startsWith('/raw/')) {
      const rate = await rateLimiter.check(`raw:${ip}`, { limit: 200, windowMs: 60_000 });
      if (rate.limited) {
        metrics.rateLimited++;
        return new Response('Too Many Requests', { status: 429, headers: getApiSecurityHeaders() });
      }

      const rawPayload = path.slice('/raw/'.length);
      if (!rawPayload || rawPayload.length > 4096) return fallbackResponse();

      const parsed = stripVersion(rawPayload);
      if (!parsed || parsed.version < 3 || parsed.version > FORMAT_VERSION) {
        return fallbackResponse();
      }

      const validation = validatePayload(parsed.body);
      if (!validation.isValid) return fallbackResponse();

      const faviconMode = url.searchParams.get('mode') === 'favicon' || url.searchParams.has('favicon');
      const previewMode = url.searchParams.get('mode') === 'preview' || url.searchParams.has('preview');
      const faviconBg = faviconMode ? (url.searchParams.get('bg') || '#0a0a0c') : undefined;
      const format = (
        url.searchParams.get('format') ||
        url.searchParams.get('type') ||
        (url.searchParams.has('png') ? 'png' : null) ||
        (url.searchParams.has('webp') ? 'webp' : 'svg')
      ).toLowerCase();

      try {
        const startTime = Date.now();
        const svg = compileToSvg(parsed.body, { faviconBackground: faviconBg, isPreview: previewMode });
        if (!svg) return fallbackResponse();

        let body: BodyInit = svg;
        let contentType = 'image/svg+xml';

        if (format === 'png') {
          const buffer = await withTimeout(
            sharp(Buffer.from(svg)).png().toBuffer(),
            5000,
            'sharp png (raw)'
          );
          body = buffer as unknown as BodyInit;
          contentType = 'image/png';
        } else if (format === 'webp') {
          const buffer = await withTimeout(
            sharp(Buffer.from(svg)).webp().toBuffer(),
            5000,
            'sharp webp (raw)'
          );
          body = buffer as unknown as BodyInit;
          contentType = 'image/webp';
        }

        const elapsed = Date.now() - startTime;
        recordRenderTime(elapsed);

        return new Response(body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
            ...getAssetSecurityHeaders(),
          },
        });
      } catch (e) {
        console.error(`[Backend Error] raw: ${e instanceof Error ? e.message : String(e)}`);
        return fallbackResponse();
      }
    }

    // --- Routing: /i/:payload (statyczna strona podglądu do udostępniania - Discord/Facebook/Twitter) ---
    if (path.startsWith('/i/')) {
      const payload = path.split('/')[2];
      if (!payload || !PAYLOAD_CHAR_REGEX.test(payload)) {
        return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
      }

      const origin = `${url.protocol}//${url.host}`;
      const imageUrl = `${origin}/r/${payload}?png`;
      const pageUrl = `${origin}/i/${payload}`;
      const safePayload = escapeHtml(payload);

      const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ikona SVG | dot.qrware.pl</title>
<meta name="description" content="Ikona wektorowa wygenerowana w dot.qrware.pl">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="Ikona SVG - dot.qrware.pl">
<meta property="og:description" content="Wygenerowana ikona wektorowa stworzona w dot.qrware.pl">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="dot.qrware.pl">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Ikona SVG - dot.qrware.pl">
<meta name="twitter:image" content="${imageUrl}">
<style>
  body { background:#0a0a0c; color:#e2e8f0; font-family: system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; gap:1.5rem; }
  img { width:192px; height:192px; image-rendering:auto; background-image: radial-gradient(#22222a 1px, transparent 1px); background-size:16px 16px; border-radius:12px; }
  a { color:#60a5fa; text-decoration:none; }
</style>
</head>
<body>
  <img src="/r/${safePayload}" alt="Ikona SVG dot.qrware.pl">
  <p>Utworzone w <a href="/">dot.qrware.pl</a></p>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...getPageSecurityHeaders() },
      });
    }

    // --- Routing: /p/:id (publiczny podgląd linku statycznego) ---
    if (path.startsWith('/p/')) {
      const publicId = path.split('/')[2];
      if (!publicId) {
        return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
      }

      const entry = await getLinkByPublicId(publicId);
      if (!entry) {
        return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
      }

      const origin = `${url.protocol}//${url.host}`;
      const imageUrl = `${origin}/r/${entry.payload}`;
      const pageUrl = `${origin}/p/${publicId}`;
      const safePayload = escapeHtml(entry.payload);
      const safeTitle = escapeHtml(entry.title);

      const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} | dot.qrware.pl</title>
<meta name="description" content="Ikona wektorowa &quot;${safeTitle}&quot; wygenerowana w dot.qrware.pl">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${safeTitle} - dot.qrware.pl">
<meta property="og:description" content="Ikona wektorowa stworzona w dot.qrware.pl">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="dot.qrware.pl">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle} - dot.qrware.pl">
<meta name="twitter:image" content="${imageUrl}">
<style>
  body { background:#0a0a0c; color:#e2e8f0; font-family: system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; gap:1.5rem; }
  img { width:192px; height:192px; image-rendering:auto; background-image: radial-gradient(#22222a 1px, transparent 1px); background-size:16px 16px; border-radius:12px; }
  a { color:#60a5fa; text-decoration:none; }
</style>
</head>
<body>
  <img src="/r/${safePayload}" alt="${safeTitle}">
  <p><strong>${safeTitle}</strong> &middot; Utworzone w <a href="/">dot.qrware.pl</a></p>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...getPageSecurityHeaders() },
      });
    }

    // --- Routing: /o/:id (strona właściciela - edycja linku statycznego) ---
    if (path.startsWith('/o/')) {
      const ownerId = path.split('/')[2];
      if (!ownerId) {
        return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
      }

      const entry = await getLinkByOwnerId(ownerId);
      if (!entry) {
        return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
      }

      const safePayload = escapeHtml(entry.payload);
      const safeTitle = escapeHtml(entry.title);
      const safeOwnerId = escapeHtml(ownerId);

      const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Edytuj: ${safeTitle} | dot.qrware.pl</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#0a0a0c; color:#e2e8f0; font-family: system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; min-height:100vh; padding:2rem 1rem; }
  h1 { font-size:1.25rem; margin-bottom:1.5rem; color:#94a3b8; }
  .container { display:flex; flex-direction:column; align-items:center; gap:1rem; max-width:600px; width:100%; }
  .preview { background-image: radial-gradient(#22222a 1px, transparent 1px); background-size:16px 16px; border-radius:12px; padding:1rem; }
  .preview img { width:192px; height:192px; display:block; }
  .info { display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; font-size:0.85rem; color:#64748b; }
  .info a { color:#60a5fa; text-decoration:none; }
  .info a:hover { text-decoration:underline; }
  .actions { display:flex; gap:0.75rem; flex-wrap:wrap; justify-content:center; margin-top:0.5rem; }
  .btn { padding:0.5rem 1rem; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; cursor:pointer; font-size:0.9rem; text-decoration:none; transition:background 0.15s; }
  .btn:hover { background:#334155; }
  .btn-primary { background:#3b82f6; border-color:#3b82f6; color:#fff; }
  .btn-primary:hover { background:#2563eb; }
  .url-box { background:#1e293b; border:1px solid #334155; border-radius:8px; padding:0.75rem 1rem; font-size:0.85rem; word-break:break-all; color:#94a3b8; width:100%; text-align:center; }
  .url-box code { color:#60a5fa; }
</style>
</head>
<body>
  <h1>✏️ Edycja linku statycznego</h1>
  <div class="container">
    <div class="preview">
      <img src="/r/${safePayload}" alt="${safeTitle}">
    </div>
    <p style="font-size:1.1rem;font-weight:600;">${safeTitle}</p>
    <div class="info">
      <span>Publiczny: <a href="/p/${escapeHtml(entry.publicId)}">/p/${escapeHtml(entry.publicId)}</a></span>
      <span>Utworzono: ${new Date(entry.createdAt).toLocaleDateString('pl-PL')}</span>
    </div>
    <div class="url-box">
      Link publiczny: <code>${PUBLIC_ORIGIN}/p/${escapeHtml(entry.publicId)}</code>
    </div>
    <div class="actions">
      <a href="${PUBLIC_ORIGIN}/?import=${safePayload}" class="btn btn-primary">✏️ Edytuj w edytorze</a>
      <a href="/" class="btn">🏠 Strona główna</a>
    </div>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...getPageSecurityHeaders() },
      });
    }

    // --- Routing: /api/batch (batch rendering wielu ikon) ---
    if (path === '/api/batch' && req.method === 'POST') {
      metrics.requests++;

      // Tier-based API access: anonymous (free, IP-limited) vs. paid API keys.
      // NOTE: limits are currently disabled (DOT_DISABLE_LIMITS=1) so all users
      // work without limits. Re-enable by removing the flag / uncommenting below.
      const tier = resolveTier(req.headers.get('authorization'));
      if (!limitsDisabled()) {
        const limits = batchLimits(tier);
        // Key rate-limit buckets are per-key for paid; per-IP for free.
        const keyForLimit = tier === 'paid'
          ? `batch:key:${req.headers.get('authorization')!.replace(/^Bearer\s+/i, '')}`
          : `batch:${ip}`;
        const rate = await rateLimiter.check(keyForLimit, limits);
        if (rate.limited) {
          metrics.rateLimited++;
          return jsonResponse({ error: 'Too many requests' }, 429);
        }
      }

      try {
        const body = await readJsonBody(req);
        if (!body) return jsonResponse({ error: 'Invalid or oversized JSON body' }, 400);
        const payloads: string[] = body?.payloads;
        const format: string = (body?.format || 'svg').toLowerCase();

        if (!Array.isArray(payloads) || payloads.length === 0) {
          return jsonResponse({ error: 'payloads must be a non-empty array' }, 400);
        }
        if (payloads.length > 20) {
          return jsonResponse({ error: 'Maximum 20 payloads per batch request' }, 400);
        }
        if (!['svg', 'png', 'webp'].includes(format)) {
          return jsonResponse({ error: 'format must be svg, png, or webp' }, 400);
        }

        const startTime = Date.now();

        const CONCURRENCY = 5;
        const results: { payload: string; ok: boolean; data?: string; error?: string }[] = new Array(payloads.length);

        async function renderOne(payload: string, index: number): Promise<void> {
          if (typeof payload !== 'string' || payload.length === 0 || payload.length > 512) {
            results[index] = { payload, ok: false, error: 'Invalid payload' };
            return;
          }
          const svg = renderIcon(payload);
          if (!svg) {
            results[index] = { payload, ok: false, error: 'Invalid payload' };
            return;
          }

          if (format === 'svg') {
            results[index] = { payload, ok: true, data: svg };
          } else {
            try {
              const buffer = format === 'png'
                ? await withTimeout(sharp(Buffer.from(svg)).png().toBuffer(), 5000, `batch png #${index}`)
                : await withTimeout(sharp(Buffer.from(svg)).webp().toBuffer(), 5000, `batch webp #${index}`);
              results[index] = { payload, ok: true, data: buffer.toString('base64') };
            } catch {
              results[index] = { payload, ok: false, error: 'Conversion failed' };
            }
          }
        }

        // Semafory: przetwarzaj w grupach po CONCURRENCY
        for (let i = 0; i < payloads.length; i += CONCURRENCY) {
          const chunk = payloads.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map((p, j) => renderOne(p, i + j)));
        }

        const elapsed = Date.now() - startTime;
        recordRenderTime(elapsed);

        return jsonResponse({ results, elapsedMs: elapsed });
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }
    }

    // --- Preflight CORS dla wszystkich endpointów API ---
    if (req.method === 'OPTIONS' && path.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: getApiSecurityHeaders(),
      });
    }

    // --- Routing: /api/health (health check) ---
    if (path === '/api/health') {
      metrics.requests++;
      return jsonResponse({
        status: 'ok',
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        version: FORMAT_VERSION,
        features: {
          redis: redisCacheEnabled,
          sqlite: sqliteEnabled,
        },
      });
    }

    // --- Routing: /api/metrics (metryki serwera) ---
    if (path === '/api/metrics') {
      metrics.requests++;
      const avgRenderMs = metrics.renderCount > 0
        ? Math.round(metrics.totalRenderMs / metrics.renderCount)
        : 0;
      return jsonResponse({
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        requests: metrics.requests,
        errors: metrics.errors,
        rateLimited: metrics.rateLimited,
        avgRenderMs,
        renderCount: metrics.renderCount,
        cache: renderCache.getStats(),
        features: {
          redis: redisCacheEnabled,
          sqlite: sqliteEnabled,
        },
      });
    }

    // --- Routing: /api/docs (dokumentacja w Markdown) ---
    if (path === '/api/docs') {
      metrics.requests++;
      const docsPath = new URL('../../data/docs.md', import.meta.url).pathname;
      const file = Bun.file(docsPath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            ...getApiSecurityHeaders(),
          },
        });
      }
      return new Response('# Dokumentacja\n\nDokumentacja jest w trakcie tworzenia.', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', ...getApiSecurityHeaders() },
      });
    }

    // --- Routing: /api/links (statyczne linki) ---
    if (path === '/api/links') {
      if (req.method === 'POST') {
        const rate = await rateLimiter.check(`links-create:${ip}`, { limit: 20, windowMs: 60_000 });
        if (rate.limited) { metrics.rateLimited++; return jsonResponse({ error: 'Too many requests' }, 429); }

        // Freemium: free users get a limited number of static links per day.
        // NOTE: limits currently disabled (DOT_DISABLE_LIMITS=1) → unlimited.
        const tier = resolveTier(req.headers.get('authorization'));
        if (!limitsDisabled()) {
          const quota = staticLinkQuota(tier);
          if (quota !== null) {
            const dailyKey = `links-daily:${ip}:${Math.floor(Date.now() / 86_400_000)}`;
            const created = await rateLimiter.check(dailyKey, { limit: quota, windowMs: 86_400_000 });
            if (created.limited) {
              metrics.rateLimited++;
              return jsonResponse({
                error: 'Free plan allows only ' + quota + ' static links per day. Upgrade for unlimited links.',
                upgrade: true,
              }, 429);
            }
          }
        }

        try {
          const body = await readJsonBody(req);
          if (!body) return jsonResponse({ error: 'Invalid or oversized JSON body' }, 400);
          const result = await createStaticLink(body?.payload, body?.title);
          if (!result.success) return jsonResponse({ error: result.error }, 400);
          return jsonResponse({
            publicUrl: `${PUBLIC_ORIGIN}/p/${result.entry!.publicId}`,
            ownerUrl: `${PUBLIC_ORIGIN}/o/${result.entry!.ownerId}`,
            entry: result.entry,
          }, 201);
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }

      if (req.method === 'GET') {
        const ownerId = url.searchParams.get('ownerId');
        if (!ownerId) return jsonResponse({ error: 'Missing ownerId' }, 400);

        const entry = await getLinkByOwnerId(ownerId);
        if (!entry) return jsonResponse({ error: 'Link not found' }, 404);
        return jsonResponse({ entry });
      }

      if (req.method === 'PUT') {
        const rate = await rateLimiter.check(`links-update:${ip}`, { limit: 30, windowMs: 60_000 });
        if (rate.limited) { metrics.rateLimited++; return jsonResponse({ error: 'Too many requests' }, 429); }

        try {
          const body = await readJsonBody(req);
          if (!body) return jsonResponse({ error: 'Invalid or oversized JSON body' }, 400);
          const result = await updateStaticLink(body?.ownerId, body?.payload, body?.title);
          if (!result.success) return jsonResponse({ error: result.error }, 400);
          return jsonResponse({ entry: result.entry });
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }

      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    // --- Routing: /api/gallery (publiczna galeria ikon) ---
    if (path === '/api/gallery') {
      if (req.method === 'GET') {
        const rate = await rateLimiter.check(`gallery-read:${ip}`, { limit: 60, windowMs: 60_000 });
        if (rate.limited) { metrics.rateLimited++; return jsonResponse({ error: 'Too many requests' }, 429); }

        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
        const result = await listGalleryEntries(page, limit);
        return jsonResponse(result);
      }

      if (req.method === 'POST') {
        const rate = await rateLimiter.check(`gallery-write:${ip}`, { limit: 10, windowMs: 60_000 });
        if (rate.limited) { metrics.rateLimited++; return jsonResponse({ error: 'Too many requests' }, 429); }

        try {
          const body = await readJsonBody(req);
          if (!body) return jsonResponse({ error: 'Invalid or oversized JSON body' }, 400);
          const result = await addGalleryEntry(body?.payload, body?.title);
          if (!result.success) return jsonResponse({ error: result.error }, 400);
          return jsonResponse({ entry: result.entry }, 201);
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }
      }

      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    // --- Serwowanie zbudowanych statycznych plików frontendu (dist/) ---
    const staticRate = await rateLimiter.check(`static:${ip}`, { limit: 600, windowMs: 60_000 });
    if (staticRate.limited) {
      metrics.rateLimited++;
      return new Response('Too Many Requests', { status: 429, headers: getPageSecurityHeaders() });
    }

    const relativePath = path === '/' ? '/index.html' : path;
    const staticFilePath = `${DIST_DIR}${relativePath}`;
    const file = Bun.file(staticFilePath);

    if (await file.exists()) {
      const ext = staticFilePath.split('.').pop() ?? '';
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const headers: Record<string, string> = {
        'Content-Type': mime,
        ...getPageSecurityHeaders(),
      };
      // Vite hashed assets (index-*.js/css) are immutable; HTML is not cached.
      const isHashedAsset = /[a-f0-9]{8}\.(js|css|svg|png|ico)$/.test(staticFilePath);
      headers['Cache-Control'] = isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      return new Response(file, { headers });
    }

    return new Response('Not Found', { status: 404, headers: getPageSecurityHeaders() });
  },
});

console.log(`SVG Generator running at http://localhost:${PORT}`);