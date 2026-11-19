/**
 * What was opened last on this computer, per user and space: the playlists,
 * reports and games the search offers before anything is typed
 * (components/search/quick-search.tsx). The pages note an open where it
 * happens, however one got there; the rules are in
 * @scoutable/shared/lib/recent-opens.
 */
import { noteOpened, parseRecentOpens, type OpenKind, type RecentOpen } from "@scoutable/shared/lib/recent-opens";

const key = (scope: string) => `scoutable_recent_opens:${scope}`;

/** The key the list is kept under: one per user in a space. Null while either is unknown. */
export function recentOpensScope(userId: string | null | undefined, orgId: string | null | undefined): string | null {
  return userId && orgId ? `${userId}:${orgId}` : null;
}

export function readRecentOpens(scope: string | null): RecentOpen[] {
  if (!scope) return [];
  try {
    const raw = localStorage.getItem(key(scope));
    return raw ? parseRecentOpens(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Notes that this was opened now. */
export function rememberOpened(scope: string | null, kind: OpenKind, id: string): void {
  if (!scope) return;
  try {
    localStorage.setItem(key(scope), JSON.stringify(noteOpened(readRecentOpens(scope), { kind, id }, Date.now())));
  } catch {
    // Storage is full or off: the search just offers the newest instead.
  }
}
