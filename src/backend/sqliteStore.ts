/**
 * Optional SQLite-backed persistence for gallery and static links.
 *
 * When `DOT_DB_PATH` is set, gallery + static links are stored in a single
 * SQLite database (via `bun:sqlite`), making them safe across processes on
 * the same machine and avoiding the JSON-file + in-memory-cache race window.
 *
 * When `DOT_DB_PATH` is unset, the app falls back to the existing JSON-file
 * persistence (single-process).
 *
 * For true multi-machine sharing, set `REDIS_URL` for rate-limiting/caching and
 * point `DOT_DB_PATH` at a network filesystem, or swap these stores for a
 * Postgres/Redis backend later.
 */
import { Database } from 'bun:sqlite';

const DB_PATH = process.env.DOT_DB_PATH || '';

export const sqliteEnabled = DB_PATH.length > 0;

let db: Database | null = null;

function getDb(): Database | null {
  if (!sqliteEnabled) return null;
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.run('PRAGMA journal_mode = WAL;');
    db.run(`
      CREATE TABLE IF NOT EXISTS gallery (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        title TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gallery_created ON gallery(createdAt DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_payload ON gallery(payload);
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS static_links (
        publicId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        title TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_links_owner ON static_links(ownerId);
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'paid',
        createdAt INTEGER NOT NULL
      );
    `);
  }
  return db;
}

/** Returns a new empty Database handle or null (keeps the singleton warm). */
export function sqlite(): Database | null {
  return getDb();
}

/** Close the DB (used in tests/shutdown). */
export function closeSqlite(): void {
  try {
    db?.close();
  } catch {
    // ignore
  }
  db = null;
}
