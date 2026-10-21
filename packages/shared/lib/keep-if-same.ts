/**
 * The previous value when the next one holds the same data, else the next.
 *
 * React state and context compare by identity: a background refresh that
 * hands out fresh objects with the same contents (the auth user on every
 * token refresh or tab refocus, a re-read profile or org list) re-renders
 * every consumer for nothing. Feeding the update through this keeps the old
 * object, and everything memoized on it, when nothing changed.
 *
 * Compares serialized JSON, so it suits small plain data (rows, the auth
 * user), not large collections or values with functions, Maps or cycles; a
 * value that can't be serialized counts as changed.
 */
export function keepIfSame<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (prev === null || next === null || typeof prev !== "object" || typeof next !== "object") return next;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}
