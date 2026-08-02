/**
 * Abstract rate-limiter with swappable backend (in-memory, Redis, etc.).
 *
 * The RateLimiterStore interface allows swapping implementations without
 * changing the limiter logic – just provide a store that matches the interface.
 */

// ---- Store Interface ----

export interface RateLimitStore {
  /** Returns [count, resetAt] for a key, or null if no entry exists. */
  get(key: string): Promise<{ count: number; resetAt: number } | null>;
  /** Sets the counter for a key. */
  set(key: string, count: number, resetAt: number): Promise<void>;
  /** Cleans up expired entries (optional – no-op for Redis which has TTL). */
  cleanup?(): Promise<void>;
}

// ---- Options and Result ----

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
}

// ---- RateLimiter Class ----

export class RateLimiter {
  constructor(private store: RateLimitStore) {}

  async check(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = await this.store.get(key);

    if (!bucket || now > bucket.resetAt) {
      const resetAt = now + options.windowMs;
      await this.store.set(key, 1, resetAt);
      return { limited: false, remaining: options.limit - 1, resetAt };
    }

    const count = bucket.count + 1;
    await this.store.set(key, count, bucket.resetAt);
    const limited = count > options.limit;
    return { limited, remaining: Math.max(0, options.limit - count), resetAt: bucket.resetAt };
  }
}

// ---- In-Memory Implementation (default) ----

export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(cleanupIntervalMs = 60_000) {
    setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  async get(key: string) {
    return this.buckets.get(key) ?? null;
  }

  async set(key: string, count: number, resetAt: number) {
    this.buckets.set(key, { count, resetAt });
  }

  async cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now > bucket.resetAt) this.buckets.delete(key);
    }
  }
}

// ---- Default Instance (singleton) ----

export const rateLimiter = new RateLimiter(new InMemoryRateLimitStore());

// ---- Helpers ----

/** List of trusted proxies (CIDR or IP) from which X-Forwarded-For can be trusted. */
const TRUSTED_PROXIES: string[] = (process.env.TRUSTED_PROXIES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Checks if an IP matches an entry (exact IP or CIDR prefix). */
function isIpTrusted(ip: string, trusted: string[]): boolean {
  return trusted.some((entry) => {
    if (entry.includes('/')) {
      // CIDR — simple prefix check for IPv4
      const [base, bits] = entry.split('/');
      if (!base || !bits) return false;
      const prefixLen = parseInt(bits, 10);
      const baseParts = base.split('.').map(Number);
      const ipParts = ip.split('.').map(Number);
      if (baseParts.length !== 4 || ipParts.length !== 4) return false;
      let mask = 0;
      for (let i = 0; i < 4; i++) {
        const b = Math.min(prefixLen - i * 8, 8);
        if (b <= 0) break;
        const m = (0xff << (8 - b)) & 0xff;
        if ((ipParts[i]! & m) !== (baseParts[i]! & m)) return false;
        mask += b;
      }
      return mask >= prefixLen;
    }
    return entry === ip;
  });
}

/** Extracts client IP from a Bun.serve request (trusts X-Forwarded-For only from trusted proxies). */
export function getClientIp(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
  const directIp = server.requestIP(req)?.address ?? 'unknown';

  // Only trust X-Forwarded-For when request comes from a trusted proxy
  if (TRUSTED_PROXIES.length > 0 && isIpTrusted(directIp, TRUSTED_PROXIES)) {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]!.trim();
  }

  return directIp;
}
