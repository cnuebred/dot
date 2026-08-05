/**
 * Documentation management: lists, reads, writes and deletes Markdown
 * documents in `data/docs/`. Only admin users may edit/create/delete.
 *
 * Docs are stored as `.md` files. The "main" doc is `data/docs.md`
 * (kept for backward compatibility); additional docs live in
 * `data/docs/*.md`.
 */
import { AsyncMutex, atomicWrite } from './fileMutex';

const DATA_DIR = new URL('../../data', import.meta.url).pathname;
const DOCS_DIR = new URL('../../data/docs', import.meta.url).pathname;
const MAIN_DOC = new URL('../../data/docs.md', import.meta.url).pathname;

const writeMutex = new AsyncMutex();

export interface DocMeta {
  /** URL-friendly document id (filename without `.md`). */
  id: string;
  title: string;
  /** Absolute filename on disk. */
  file: string;
  /** True for the primary docs.md file. */
  main: boolean;
}

const MAX_DOC_SIZE = 256 * 1024; // 256 KB

function sanitizeId(raw: string): string {
  return (raw || '')
    .replace(/\.md$/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Returns metadata for all available documents (main first, then data/docs/*). */
export async function listDocs(): Promise<DocMeta[]> {
  const out: DocMeta[] = [];

  // Main doc (docs.md)
  const mainFile = Bun.file(MAIN_DOC);
  if (await mainFile.exists()) {
    out.push({ id: 'intro', title: 'Introduction', file: MAIN_DOC, main: true });
  }

  // Additional docs in data/docs/
  try {
    const dir = Bun.file(DOCS_DIR);
    // Bun: iterate directory entries.
    const entries = await readDirEntries(DOCS_DIR);
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const id = sanitizeId(name);
      out.push({ id, title: titleFromId(id), file: `${DOCS_DIR}/${name}`, main: false });
    }
  } catch {
    // directory may not exist yet – ignore
  }

  return out;
}

async function readDirEntries(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const proc = await Bun.spawn(['ls', dir], { stdout: 'pipe' });
    const text = await new Response(proc.stdout).text();
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t) out.push(t);
    }
  } catch {
    // fallback: empty
  }
  return out;
}

function titleFromId(id: string): string {
  return id
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Finds a document by id. Returns null if not found. */
export async function findDoc(id: string): Promise<DocMeta | null> {
  const docs = await listDocs();
  return docs.find((d) => d.id === id) ?? null;
}

/** Reads a document's markdown content (by id). Returns null if not found. */
export async function readDoc(id: string): Promise<{ meta: DocMeta; content: string } | null> {
  const meta = await findDoc(id);
  if (!meta) return null;
  const file = Bun.file(meta.file);
  if (!(await file.exists())) return null;
  const content = await file.text();
  return { meta, content };
}

export interface WriteDocResult {
  success: boolean;
  error?: string;
  meta?: DocMeta;
}

/** Writes markdown content to a doc. If `id` doesn't exist, creates a new file. */
export async function writeDoc(id: string, content: string): Promise<WriteDocResult> {
  const cleanId = sanitizeId(id);
  if (!cleanId) return { success: false, error: 'Invalid document id' };
  if (typeof content !== 'string' || content.length > MAX_DOC_SIZE) {
    return { success: false, error: 'Document too large' };
  }

  return writeMutex.run(async () => {
    const existing = await findDoc(cleanId);

    // Editing an existing doc → write to its file.
    if (existing) {
      try {
        await atomicWrite(existing.file, content);
        return { success: true, meta: existing };
      } catch (e) {
        console.error('[Docs] Failed to write', e);
        return { success: false, error: 'Failed to save document' };
      }
    }

    // New doc → create data/docs/<id>.md
    const fileName = `${DOCS_DIR}/${cleanId}.md`;
    try {
      const dirFile = Bun.file(DOCS_DIR);
      await Bun.$`mkdir -p ${DOCS_DIR}`.quiet();
      await atomicWrite(fileName, content);
      return {
        success: true,
        meta: { id: cleanId, title: titleFromId(cleanId), file: fileName, main: false },
      };
    } catch (e) {
      console.error('[Docs] Failed to create', e);
      return { success: false, error: 'Failed to create document' };
    }
  });
}

/** Deletes a non-main document by id. Returns false if it's the main doc or not found. */
export async function deleteDoc(id: string): Promise<{ success: boolean; error?: string }> {
  const cleanId = sanitizeId(id);
  return writeMutex.run(async () => {
    const doc = await findDoc(cleanId);
    if (!doc) return { success: false, error: 'Document not found' };
    if (doc.main) return { success: false, error: 'Cannot delete the main document' };
    try {
      await Bun.$`rm -f ${doc.file}`.quiet();
      return { success: true };
    } catch (e) {
      console.error('[Docs] Failed to delete', e);
      return { success: false, error: 'Failed to delete document' };
    }
  });
}

export { MAX_DOC_SIZE };
