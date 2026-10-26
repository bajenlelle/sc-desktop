import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * An invite that waits for the person to be signed in.
 *
 * A signup's confirmation link may open in any browser, so the invite is
 * kept in two places. The proxy sets a first-party cookie when a signed-out
 * visitor opens /join/<CODE> and sends a signed-in user there once, whatever
 * account they use (same browser). The signup form also writes the code into
 * the account's user_metadata, which the sign-in paths read from a fresh
 * user object (any browser, that account) — never from the JWT, whose
 * claims lag a metadata change by up to an hour and would send a freshly
 * joined member back to the invite.
 */
export const PENDING_INVITE_COOKIE = "sc_pending_invite";
export const INVITE_CODE = /^[A-Za-z0-9]{6}$/;

/** The /join path for the invite a signup was made for, if any. */
export function pendingInvitePath(user: User | null | undefined): string | null {
  const code = user?.user_metadata?.pending_invite;
  return typeof code === "string" && INVITE_CODE.test(code) ? `/join/${code.toUpperCase()}` : null;
}

/** Forget the invite once /join has settled it. Best effort: a leftover only means one more look at the page. */
export async function clearPendingInvite(
  supabase: SupabaseClient,
  user: User | null | undefined,
  code: string,
): Promise<void> {
  const held = user?.user_metadata?.pending_invite;
  if (typeof held !== "string" || held.toUpperCase() !== code.toUpperCase()) return;
  await supabase.auth.updateUser({ data: { pending_invite: null } }).catch(() => {});
}
