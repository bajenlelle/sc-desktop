import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { createClient } from "@/lib/supabase/client";
import { parsePlayerAccess, type PlayerAccess } from "@scoutable/shared/lib/player-access";

/**
 * The signed-in user's player passes (`get_my_player_access`): free games
 * left, bought singles, season passes and receipts, for the personal space.
 * Null until loaded or when the read fails; callers keep their old UI then.
 */
export function usePlayerAccess(): { access: PlayerAccess | null; reload: () => void } {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [loaded, setLoaded] = useState<{ uid: string; access: PlayerAccess | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    createClient()
      .rpc("get_my_player_access")
      .then(({ data, error }) => {
        if (!cancelled) setLoaded({ uid, access: error || !data ? null : parsePlayerAccess(data) });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, nonce]);

  // A previous account's answer never shows after a sign-in switch.
  return { access: loaded && loaded.uid === uid ? loaded.access : null, reload };
}
