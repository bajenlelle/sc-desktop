/**
 * Where the search panel lives in the window (components/root-layout.tsx).
 * It says whether the page shown has a search at all: the coach's workspace,
 * once the page itself is shown (not the screens a route gate puts in its
 * place). The panel's own code is fetched the first time it opens, so a
 * session that never searches loads none of it.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useRouteGate } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { setQuickSearchAvailable, useQuickSearchOpen, type SearchScope } from "@/lib/quick-search-store";

const QuickSearch = lazy(() => import("./quick-search"));

/** Who gets the search: the roles the sidebar lists Home, Playlists and the Library for. */
export function useQuickSearchScope(): SearchScope | null {
  const { user, activeOrgId, activeOrgRole, activeOrgIsPersonal } = useAuth();
  const gate = useRouteGate();
  const userId = user?.id ?? null;
  const can = gate === "app" && (activeOrgRole === "coach" || activeOrgRole === "admin");
  return useMemo(
    () => (can && userId && activeOrgId ? { userId, orgId: activeOrgId, personal: activeOrgIsPersonal } : null),
    [can, userId, activeOrgId, activeOrgIsPersonal],
  );
}

export function QuickSearchHost() {
  const scope = useQuickSearchScope();
  const open = useQuickSearchOpen();
  const available = scope !== null;
  useEffect(() => {
    setQuickSearchAvailable(available);
    return () => setQuickSearchAvailable(false);
  }, [available]);

  // Kept once opened, so the panel can leave with its motion.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);

  if (!scope || !(open || opened)) return null;
  return (
    <Suspense fallback={null}>
      <QuickSearch scope={scope} />
    </Suspense>
  );
}
