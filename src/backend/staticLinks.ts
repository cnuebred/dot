import { validateAndDecodePayload } from './payloadValidation';
import { AsyncMutex, atomicWrite } from './fileMutex';

/** Static link entry. */
export interface StaticLinkEntry {
  publicId: string;
  ownerId: string;
  payload: string;
  title: string;
  createdAt: number;
}

export interface CreateLinkResult {
  success: boolean;
  error?: string;
  entry?: StaticLinkEntry;
}

const MAX_ENTRIES = 500;
const MAX_TITLE_LENGTH = 60;
const PUBLIC_ID_LENGTH = 8;
const PUBLIC_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const DATA_FILE = new URL('../../data/staticLinks.json', import.meta.url).pathname;

let cache: StaticLinkEntry[] = [];
let loaded = false;
const writeMutex = new AsyncMutex();

function generatePublicId(): string {
  const bytes = new Uint8Array(PUBLIC_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) {
    result += PUBLIC_ID_CHARS[bytes[i]! % PUBLIC_ID_CHARS.length];
  }
  return result;
}

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
    console.error('[StaticLinks] Failed to load persisted data', e);
    cache = [];
  }
}

async function persist(): Promise<void> {
  try {
    await atomicWrite(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[StaticLinks] Failed to persist data', e);
  }
}

/** Creates a new static link. */
export async function createStaticLink(payload: string, title: string): Promise<CreateLinkResult> {
  return writeMutex.run(async () => {
    await ensureLoaded();

    const validation = validateAndDecodePayload(payload);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const safeTitle = (typeof title === 'string' ? title : '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';

    const entry: StaticLinkEntry = {
      publicId: generatePublicId(),
      ownerId: crypto.randomUUID(),
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

/** Gets a link by publicId. */
export async function getLinkByPublicId(publicId: string): Promise<StaticLinkEntry | null> {
  await ensureLoaded();
  return cache.find((e) => e.publicId === publicId) ?? null;
}

/** Gets a link by ownerId. */
export async function getLinkByOwnerId(ownerId: string): Promise<StaticLinkEntry | null> {
  await ensureLoaded();
  return cache.find((e) => e.ownerId === ownerId) ?? null;
}

/** Updates the payload of an existing link (by ownerId). */
export async function updateStaticLink(ownerId: string, payload: string, title: string): Promise<CreateLinkResult> {
  return writeMutex.run(async () => {
    await ensureLoaded();

    const idx = cache.findIndex((e) => e.ownerId === ownerId);
    if (idx === -1) {
      return { success: false, error: 'Link does not exist' };
    }

    const validation = validateAndDecodePayload(payload);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }

    const safeTitle = (typeof title === 'string' ? title : '').trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';

    cache[idx] = { ...cache[idx], payload, title: safeTitle };
    await persist();
    return { success: true, entry: cache[idx] };
  });
}