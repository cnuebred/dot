/**
 * Shared helpers for bounding Redis/network operations so that a dead or
 * unreachable Redis never hangs a request indefinitely.
 *
 * Bun's `RedisClient` connects lazily and, when the server dies mid-session,
 * pending commands can hang FOREVER (they never resolve or reject). Without a
 * timeout, Bun.serve's default 10s `idleTimeout` kills such requests, which
 * surfaces as:
 *   "request timed out after 10 seconds" + "socket hang up" proxy errors.
 *
 * Every Redis `get`/`set` call site is wrapped in `redisCall()` so a hung
 * command is bounded to a short window and treated as a cache miss (graceful
 * degradation), instead of blocking the whole request.
 */

/** Bounds an operation to `ms`; throws on timeout. */
export async function withOperationTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'op'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis ${label} timed out (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
