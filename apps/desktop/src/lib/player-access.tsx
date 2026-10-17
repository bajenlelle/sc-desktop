import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { parsePlayerAccess, type PlayerAccess } from "@scoutable/shared/lib/player-access";

/**
 * Player passes for the signed-in user (`get_my_player_access`): free games
 * left, bought single games, season passes, receipts. Loaded per user,
 * re-read after every import or delete (`matches-changed`) and when the app
 * regains focus, since a purchase finishes in the browser.
 *
 * `playerMode` is true while sales are on and the active space is a Free
 * personal space: that is where single games and the season pass replace
 * the Rookie/Pro upgrade path. Everywhere else the old UI stays.
 */
interface PlayerAccessValue {
  access: PlayerAccess | null;
  playerMode: boolean;
  /** Re-read now; resolves with the fresh value (null when the read fails). */
  reload: () => Promise<PlayerAccess | null>;
}

const PlayerAccessContext = createContext<PlayerAccessValue>({
  access: null,
  playerMode: false,
  reload: async () => null,
});

const FOCUS_REFRESH_MIN_MS = 15_000;

export function PlayerAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, activeOrgIsPersonal, activeOrgPlan } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ forUser: string; access: PlayerAccess | null } | null>(null);
  const lastLoadRef = useRef(0);
  const userRef = useRef(userId);
  userRef.current = userId;

  const reload = useCallback(async (): Promise<PlayerAccess | null> => {
    const uid = userRef.current;
    if (!uid) return null;
    lastLoadRef.current = Date.now();
    const { data, error } = await createClient().rpc("get_my_player_access");
    const access = error || !data ? null : parsePlayerAccess(data);
    if (error) console.error("[player-access] load failed:", error.message);
    if (userRef.current === uid) setState({ forUser: uid, access });
    return access;
  }, []);

  useEffect(() => {
    if (!userId) return;
    void reload();
    const onChanged = () => void reload();
    const onFocus = () => {
      if (Date.now() - lastLoadRef.current >= FOCUS_REFRESH_MIN_MS) void reload();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("matches-changed", onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("matches-changed", onChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, reload]);

  const access = userId && state?.forUser === userId ? state.access : null;
  const playerMode = !!access?.enabled && activeOrgIsPersonal && activeOrgPlan === "free";

  const value = useMemo(() => ({ access, playerMode, reload }), [access, playerMode, reload]);
  return <PlayerAccessContext.Provider value={value}>{children}</PlayerAccessContext.Provider>;
}

export const usePlayerAccess = () => useContext(PlayerAccessContext);
