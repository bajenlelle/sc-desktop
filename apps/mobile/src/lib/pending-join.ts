/**
 * Holds an invite code from a scoutable://join/CODE deep link that arrived
 * while signed out, so the join can resume right after sign-in. Module state
 * is enough — a cold start lands on the deep link route again anyway.
 */
let pendingCode: string | null = null;

export function setPendingJoinCode(code: string) {
  pendingCode = code;
}

/** Returns and clears the stashed code. */
export function consumePendingJoinCode(): string | null {
  const code = pendingCode;
  pendingCode = null;
  return code;
}

export function peekPendingJoinCode(): string | null {
  return pendingCode;
}
