/**
 * The signed-in user's id, for helpers that need it only to build a query
 * filter.
 *
 * Why not `auth.getUser()`: that is an unconditional `GET /auth/v1/user` round
 * trip on every call — auth-js memoizes nothing — and the DB helpers in this
 * package each opened with one. A web page load was paying six or more before
 * it issued a single data query.
 *
 * Why `getSession()` is safe here: identity is enforced server-side, not by
 * this value. PostgREST validates the JWT and RLS filters on `auth.uid()` read
 * from that verified token, so a stale or tampered local id produces an empty
 * result rather than another user's rows — the id is a narrowing hint, never
 * the access decision. `getSession()` still refreshes an expired token before
 * returning, so callers keep a usable session.
 *
 * Use `auth.getUser()` where the answer IS the security decision — a
 * server-side route guard, for example (see apps/web `(app)/layout.tsx`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.user?.id ?? null;
}
