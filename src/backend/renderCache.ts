/**
 * LRU Cache for icon rendering results.
 * 
 * Caches SVG (cheap) and PNG/WebP buffers (expensive via sharp).
 * Key: `${payload}:${format}:${faviconBg ?? ''}:${previewMode ? '1' : '0'}`
 * 
 * Parameters:
 * - maxSize: 500 entries (~1-2KB each → ~1MB RAM)
 * - ttl: 1 hour (clients already have Cache-Control: immutable)
 */

interface CacheEntry {
  svg: string;
  pngBuffer?: Buffer;
  webpBuffer?: Buffer;
  icoBuffer?: Buffer;
  createdAt: number;
}

export class RenderCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 500, ttlMs = 3_600_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /** Builds cache key from render parameters. */
  static buildKey(payload: string, format: string, faviconBg?: string, previewMode?: boolean, size?: number): string {
    return `${payload}:${format}:${faviconBg ?? ''}:${previewMode ? '1' : '0'}${size != null ? ':' + size : ''}`;
  }

  /** Gets a cache entry (null if missing or expired). */
  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // LRU: remove and re-insert at end (Map preserves insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  /** Stores an entry in cache. If full, evicts oldest (LRU). */
  set(key: string, entry: CacheEntry): void {
    // If key already exists, remove old one (will be inserted at end)
    this.cache.delete(key);

    // Evict oldest entry if limit exceeded
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, entry);
  }

  /** Returns the number of entries in cache. */
  get size(): number {
    return this.cache.size;
  }

  /** Returns cache hit/miss statistics. */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0,
    };
  }

  /** Clears the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Removes expired entries (for periodic invocation). */
  evictExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

/** Global render cache instance. */
export const renderCache = new RenderCache();