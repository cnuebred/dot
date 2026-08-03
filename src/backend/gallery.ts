import { validateAndDecodePayload } from './payloadValidation';
import { AsyncMutex, atomicWrite } from './fileMutex';
import { sqlite, sqliteEnabled } from './sqliteStore';

/** Entry in the public icon gallery. */
export interface GalleryEntry {
  id: string;
  payload: string;
  title: string;
  createdAt: number;
}

export interface AddGalleryResult {
  success: boolean;
  error?: string;
  entry?: GalleryEntry;
}

const MAX_ENTRIES = 500;
const MAX_TITLE_LENGTH = 120;

const DATA_FILE = new URL('../../data/gallery.json', import.meta.url).pathname;

let cache: GalleryEntry[] = [];
let loaded = false;
const writeMutex = new AsyncMutex();

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const file = Bun.file(DATA_FILE);
    if (await file.exists()) {
      const raw = await file.text();
      cache = JSON.parse(raw);
    }
  } catch (e) {
    console.error('[Gallery] Failed to load persisted data', e);
    cache = [];
  }
}

async function persist(): Promise<void> {
  try {
    await atomicWrite(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[Gallery] Failed to persist data', e);
  }
}

/** Returns the list of entries, newest first, with pagination. */
export async function listGalleryEntries(page = 1, limit = 50): Promise<{ entries: GalleryEntry[]; total: number; page: number; limit: number; totalPages: number }> {
  if (sqliteEnabled) {
    const db = sqlite();
    if (db) {
      const total = (db.query('SELECT COUNT(*) AS c FROM gallery').get() as any).c as number;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(Math.max(1, page), totalPages);
      const offset = (safePage - 1) * limit;
      const entries = db.query(
        'SELECT id, payload, title, createdAt FROM gallery ORDER BY createdAt DESC LIMIT ? OFFSET ?'
      ).all(limit, offset) as unknown as GalleryEntry[];
      return { entries, total, page: safePage, limit, totalPages };
    }
  }

  await ensureLoaded();
  const all = [...cache].reverse();
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * limit;
  const entries = all.slice(start, start + limit);
  return { entries, total, page: safePage, limit, totalPages };
}

/** Validates and adds a new entry to the gallery. Rejects payloads that cannot be decoded. */
export async function addGalleryEntry(payload: string, title: string): Promise<AddGalleryResult> {
  return writeMutex.run(async () => {
    const validation = validateAndDecodePayload(payload);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const safeTitle = (typeof title === 'string' ? title : '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';

    // SQLite path – process-safe, no shared in-memory cache.
    if (sqliteEnabled) {
      const db = sqlite();
      if (db) {
        try {
          const existing = db.query('SELECT payload FROM gallery WHERE payload = ?').get(payload);
          if (existing) return { success: false, error: 'This payload is already in the gallery' };

          const entry: GalleryEntry = {
            id: crypto.randomUUID(),
            payload,
            title: safeTitle,
            createdAt: Date.now(),
          };
          db.query(
            'INSERT INTO gallery (id, payload, title, createdAt) VALUES (?, ?, ?, ?)'
          ).run(entry.id, entry.payload, entry.title, entry.createdAt);

          // Enforce MAX_ENTRIES by pruning oldest.
          const excess = (db.query('SELECT COUNT(*) AS c FROM gallery').get() as any).c as number - MAX_ENTRIES;
          if (excess > 0) {
            db.query(
              'DELETE FROM gallery WHERE id IN (SELECT id FROM gallery ORDER BY createdAt ASC LIMIT ?)'
            ).run(excess);
          }
          return { success: true, entry };
        } catch (e) {
          console.error('[Gallery] SQLite insert failed', e);
          return { success: false, error: 'Failed to add entry' };
        }
      }
    }

    // JSON-file fallback.
    await ensureLoaded();
    const existing = cache.find((e) => e.payload === payload);
    if (existing) {
      return { success: false, error: 'This payload is already in the gallery' };
    }

    const entry: GalleryEntry = {
      id: crypto.randomUUID(),
      payload,
      title: safeTitle,
      createdAt: Date.now(),
    };

    cache.push(entry);
    if (cache.length > MAX_ENTRIES) {
      cache = cache.slice(cache.length - MAX_ENTRIES);
    }

    await persist();
    return { success: true, entry };
  });
}
