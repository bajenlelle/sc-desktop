/**
 * The page the coach was on last, per user and space on this computer: where
 * the app opens next time (pages/start.tsx). Only the pages worth reopening
 * are kept (`rememberablePath` in @scoutable/shared/lib/start-page); any other
 * page leaves the last one as it was.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { rememberablePath } from "@scoutable/shared/lib/start-page";
import { useAuth } from "@/lib/auth-context";
import { recentOpensScope } from "@/lib/recent-opens";

const key = (scope: string) => `scoutable_last_page:${scope}`;

/** One per user in a space, as the recent opens are. Null while either is unknown. */
export const lastPageScope = recentOpensScope;

export function readLastPage(scope: string | null): string | null {
  if (!scope) return null;
  try {
    return localStorage.getItem(key(scope));
  } catch {
    return null;
  }
}

export function rememberLastPage(scope: string | null, path: string): void {
  if (!scope) return;
  try {
    localStorage.setItem(key(scope), path);
  } catch {
    // Storage is full or off: the app opens on Playlists instead.
  }
}

/**
 * Notes each page worth reopening as the coach reaches it (mounted once, in
 * RootLayout). Once per page reached and once per space switch, as soon as the
 * user and space are known: the page the coach is on after a switch is the new
 * space's last page. A game of the space left is safe to note there, because
 * the start page opens a game only while it is among that space's open games.
 */
export function useRememberLastPage(): void {
  const { pathname } = useLocation();
  const { user, activeOrgId } = useAuth();
  const scope = lastPageScope(user?.id, activeOrgId);
  const noted = useRef<string | null>(null);
  useEffect(() => {
    if (!scope) return;
    const at = `${scope}\n${pathname}`;
    if (noted.current === at) return;
    noted.current = at;
    const path = rememberablePath(pathname);
    if (path) rememberLastPage(scope, path);
  }, [pathname, scope]);
}
