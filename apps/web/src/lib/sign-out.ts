import { createClient } from "@/lib/supabase/client";

let leaving = false;

/** True once signOutAndLeave has started: the page is about to be replaced. */
export function isLeaving(): boolean {
  return leaving;
}

/**
 * Signs this browser out and loads the sign-in page fresh.
 *
 * Signing out used to clear the auth state, then navigate. Clearing it
 * re-rendered the signed-in page without a user first, and on an iPhone,
 * where the browser wraps emails and numbers in elements of its own, React
 * could no longer find the text it was removing: the page threw
 * (NotFoundError), "Something went wrong" showed, and only a refresh reached
 * sign-in. Now nothing re-renders: while leaving, the auth context keeps its
 * state, and a full page load drops everything signed-in at once.
 *
 * Local scope: signing out here leaves the account's other devices signed in.
 */
export async function signOutAndLeave(to = "/login"): Promise<void> {
  leaving = true;
  try {
    await createClient().auth.signOut({ scope: "local" });
  } catch {
    // Already revoked (a deleted account): the page goes either way.
  }
  window.location.replace(to);
}
