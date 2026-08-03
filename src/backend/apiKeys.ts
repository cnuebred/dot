/**
 * Lightweight API-key / tier system for monetized endpoints.
 *
 * Two tiers:
 *  - `free`  : anonymous (no key) – IP rate-limited, limited static links.
 *  - `paid`  : valid API key – higher `/api/batch` limits, unlimited static links.
 *
 * Keys are provided via the `DOT_API_KEYS` env var as a comma-separated list:
 *   DOT_API_KEYS=sk_live_xxxx,sk_live_yyyy
 *
 * When `DOT_DB_PATH` is set, keys can additionally be stored in the SQLite
 * `api_keys` table (INSERT via SQL or a future admin endpoint).
 *
 * This is intentionally simple and swap-in: replace `isValidPaidKey` with a
 * call to Stripe/Postgres when a real billing system is added.
 */
import { sqlite, sqliteEnabled } from './sqliteStore';

export type ApiTier = 'free' | 'paid';

// Keys configured in the environment (production bootstrap).
const ENV_KEYS: ReadonlySet<string> = new Set(
  (process.env.DOT_API_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

/** Resolves an API key to its tier. Empty/missing key → 'free'. */
export function resolveTier(authHeader: string | null): ApiTier {
  if (!authHeader) return 'free';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!key) return 'free';
  if (ENV_KEYS.has(key)) return 'paid';
  return dbKeyIsPaid(key) ? 'paid' : 'free';
}

/** Checks the SQLite-backed key table (if enabled). */
function dbKeyIsPaid(key: string): boolean {
  if (!sqliteEnabled) return false;
  const db = sqlite();
  if (!db) return false;
  try {
    const row = db.query('SELECT 1 AS found FROM api_keys WHERE key = ? AND tier = ?').get(key, 'paid');
    return !!row;
  } catch {
    return false;
  }
}

/** Creates the api_keys table (idempotent). Called lazily. */
export function ensureApiKeysTable(): void {
  if (!sqliteEnabled) return;
  const db = sqlite();
  if (!db) return;
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'paid',
        createdAt INTEGER NOT NULL
      );
    `);
  } catch {
    // ignore – table may already exist or DB unavailable.
  }
}

/**
 * Tier-based rate-limit window for `/api/batch`.
 * Paid keys get a much higher per-key allowance; free (IP) requests share the
 * anonymous limit.
 *
 * NOTE: When `DOT_DISABLE_LIMITS` is set to a truthy value, limits are
 * effectively disabled (no enforcement) so every user works without limits.
 * The code below is kept intact and can be re-enabled by removing the flag.
 */
export function limitsDisabled(): boolean {
  const v = process.env.DOT_DISABLE_LIMITS;
  return v === '1' || v === 'true' || v === 'yes';
}

export function batchLimits(tier: ApiTier): { limit: number; windowMs: number } {
  if (tier === 'paid') {
    return { limit: Number(process.env.DOT_BATCH_PAID_LIMIT || 1000), windowMs: 60_000 };
  }
  return { limit: Number(process.env.DOT_BATCH_FREE_LIMIT || 30), windowMs: 60_000 };
}

/** Max static links allowed per IP/day for free users (paid = unlimited). */
export function staticLinkQuota(tier: ApiTier): number | null {
  if (tier === 'paid') return null; // unlimited
  return Number(process.env.DOT_LINKS_FREE_QUOTA || 5);
}
