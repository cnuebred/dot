/**
 * Redis-backed render cache overlay.
 *
 * When REDIS_URL is configured, rendered SVG/PNG/WebP/ICO entries are cached
 * in Redis so that multiple processes/machines share render work instead of
 * each rendering the same payload independently.
 *
 * The local LRU (`renderCache`) remains the fast path; Redis acts as the
 * shared, slightly slower tier. On a local miss we try Redis, and on a Redis
 * miss we render + store in both.
 */
import type { RenderCache } from './renderCache';

const REDIS_URL = process.env.REDIS_URL || process.env.VALKEY_URL || '';

/** Whether a Redis-backed shared cache is enabled. */
export const redisCacheEnabled = REDIS_URL.length > 0;

interface RedisEntry {
  svg: string;
  png?: string; // base64
  webp?: string; // base64
  ico?: string; // base64
}

let client: any = null;

function getClient(): any {
  if (!redisCacheEnabled) return null;
  if (!client) client = new (Bun as any).RedisClient(REDIS_URL);
  return client;
}

const PREFIX = 'dot:render:';

/** Attempts to populate the local cache from Redis. Returns true on hit. */
export async function tryRedisGet(cache: RenderCache, key: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const raw = await c.get(PREFIX + key);
    if (!raw) return false;
    const entry: RedisEntry = JSON.parse(raw);
    if (!entry?.svg) return false;
    const local = {
      svg: entry.svg,
      createdAt: Date.now(),
    };
    if (entry.png) {
      const buf = Buffer.from(entry.png, 'base64');
      (local as any).pngBuffer = buf;
    }
    if (entry.webp) {
      const buf = Buffer.from(entry.webp, 'base64');
      (local as any).webpBuffer = buf;
    }
    if (entry.ico) {
      const buf = Buffer.from(entry.ico, 'base64');
      (local as any).icoBuffer = buf;
    }
    cache.set(key, local as any);
    return true;
  } catch {
    return false;
  }
}

/** Stores a cache entry in Redis for cross-process sharing. */
export async function redisSet(cache: RenderCache, key: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  const entry = cache.get(key);
  if (!entry) return;
  try {
    const redisEntry: RedisEntry = { svg: entry.svg };
    if (entry.pngBuffer) redisEntry.png = (entry.pngBuffer as Buffer).toString('base64');
    if (entry.webpBuffer) redisEntry.webp = (entry.webpBuffer as Buffer).toString('base64');
    if (entry.icoBuffer) redisEntry.ico = (entry.icoBuffer as Buffer).toString('base64');
    // TTL 1 hour – matches the local cache TTL.
    await c.set(PREFIX + key, JSON.stringify(redisEntry), 'EX', 3600);
  } catch {
    // Redis down – non-fatal.
  }
}
