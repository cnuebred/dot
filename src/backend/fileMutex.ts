/**
 * Simple async mutex for serializing file write operations.
 * Prevents race conditions when two parallel requests modify the same file.
 */
import { rename } from 'node:fs/promises';

export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/**
 * Atomic file write: writes to a temp file, then renames.
 * Prevents data corruption in case of a crash during write.
 */
export async function atomicWrite(path: string, data: string): Promise<void> {
  const tmpPath = path + '.tmp';
  await Bun.write(tmpPath, data);
  await rename(tmpPath, path);
}