/**
 * Cross-device theme sync watcher — mobile twin of the desktop/web
 * theme-sync components (keep in sync). Renders nothing.
 *
 * Deltas from the web twin: the mode axis lives in MobileThemeProvider
 * (not next-themes), the supabase client is the module singleton, and an
 * AppState listener resubscribes the realtime channel after iOS/Android
 * suspend the socket in the background. Missed events are also covered by
 * the auth context's AppState-triggered profile reload (T1).
 *
 * Protocol (pure logic + rationale in @scoutable/shared/lib/theme-sync):
 * adoption sets lastServerRef BEFORE applying and never writes; local
 * changes write only diffs against the ref, and only after a first server
 * snapshot exists. Failed writes revert the ref.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  filterUnappliedSlots,
  isTransientRealtimeFailure,
  planAdoption,
  planWrite,
  prefsFromRow,
  REALTIME_REPORT_GRACE_MS,
  realtimeReportVerdict,
  unappliedSlotsFor,
  type UnappliedSlots,
  type ThemePrefs,
} from "@scoutable/shared/lib/theme-sync";
import { saveThemePrefs } from "@scoutable/shared/lib/themes-db";
import { reportDbError } from "@scoutable/shared/lib/report";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useAppTheme } from "@/lib/theme-context";

export function ThemeSync() {
  const { user, profile } = useAuth();
  const { slots, modeSetting, adoptColorThemes, setModeSetting } = useAppTheme();
  const userId = user?.id ?? null;

  /** Raw server values last observed or optimistically written; null until the first snapshot for this user. */
  const lastServerRef = useRef<ThemePrefs | null>(null);
  /** Slot fields the last adoption could not render (unknown id from a newer client) — excluded from writes until a real local pick reclaims them. */
  const unappliedRef = useRef<UnappliedSlots>({ themeDark: false, themeLight: false });
  /** Local values at the previous T3 evaluation, to tell user picks from unapplied fallbacks. */
  const prevLocalRef = useRef<ThemePrefs | null>(null);

  // Current local state, readable from stable callbacks without stale
  // closures. Mirrored in an effect (never during render): this effect is
  // declared first, so it runs before T1/T3 below within every commit.
  const localRef = useRef<ThemePrefs>({ themeDark: null, themeLight: null, themeMode: null });
  useEffect(() => {
    localRef.current = {
      themeDark: slots.dark,
      themeLight: slots.light,
      themeMode: modeSetting,
    };
  });

  useEffect(() => {
    lastServerRef.current = null;
    unappliedRef.current = { themeDark: false, themeLight: false };
    prevLocalRef.current = null;
  }, [userId]);

  const adopt = useCallback(
    (server: ThemePrefs) => {
      // Ref BEFORE apply: the local-watcher effect below then diffs to {}.
      lastServerRef.current = server;
      unappliedRef.current = unappliedSlotsFor(server);
      const apply = planAdoption(server, localRef.current);
      if (apply.themeDark !== undefined || apply.themeLight !== undefined) {
        adoptColorThemes({
          themeDark: apply.themeDark ?? undefined,
          themeLight: apply.themeLight ?? undefined,
        });
      }
      if (apply.themeMode) setModeSetting(apply.themeMode);
    },
    [adoptColorThemes, setModeSetting],
  );
  const adoptRef = useRef(adopt);
  useEffect(() => {
    adoptRef.current = adopt;
  });

  // T1 — profile snapshots (boot load + AppState-triggered silent reloads).
  const profileDark = profile?.themeDark ?? null;
  const profileLight = profile?.themeLight ?? null;
  const profileMode = profile?.themeMode ?? null;
  const hasProfile = !!profile;
  useEffect(() => {
    if (!userId || !hasProfile) return;
    adoptRef.current({ themeDark: profileDark, themeLight: profileLight, themeMode: profileMode });
  }, [userId, hasProfile, profileDark, profileLight, profileMode]);

  // T2 — realtime push from the user's own profiles row. `retick` re-runs
  // the effect when the app returns to the foreground with a dead socket.
  const [retick, setRetick] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let reported = false;
    let reportTimer: ReturnType<typeof setTimeout> | null = null;
    let rearmed = false;
    // Self-re-arming so a timer that only fired because the device was
    // suspended gets a real window instead of filing on wake.
    const armReportTimer = (message: string) => {
      const armedAt = Date.now();
      reportTimer = setTimeout(() => {
        reportTimer = null;
        const verdict = realtimeReportVerdict({
          joined: channel.state === "joined",
          elapsedMs: Date.now() - armedAt,
          rearmed,
        });
        if (verdict === "quiet") return;
        if (verdict === "rearm") {
          rearmed = true;
          armReportTimer(message);
          return;
        }
        reported = true;
        reportDbError("themeRealtimeSubscribe", { message });
      }, REALTIME_REPORT_GRACE_MS);
    };
    const channel = supabase
      .channel(`profile-theme-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => adoptRef.current(prefsFromRow(payload.new as Record<string, unknown>)),
      )
      .subscribe((status, err) => {
        // Realtime's cold join routinely fails once before supabase-js's own
        // rejoin succeeds, and a suspended device always drops its socket, so
        // a single failure says nothing: start a grace timer and report only a
        // channel that never comes back. One report per subscription either
        // way. Degrade silently: the AppState profile reload still catches up.
        if (status === "SUBSCRIBED") {
          if (reportTimer) {
            clearTimeout(reportTimer);
            reportTimer = null;
          }
          return;
        }
        if (!isTransientRealtimeFailure(status) || reported || reportTimer) return;
        armReportTimer(err?.message ?? status);
      });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && channel.state !== "joined") {
        setRetick((n) => n + 1);
      }
    });
    return () => {
      sub.remove();
      if (reportTimer) clearTimeout(reportTimer);
      void supabase.removeChannel(channel);
    };
  }, [userId, retick]);

  // T3 — local changes (a pick in the picker or a mode change).
  useEffect(() => {
    const local = localRef.current;
    const prevLocal = prevLocalRef.current;
    prevLocalRef.current = local;
    if (!userId) return;
    const filtered = filterUnappliedSlots(
      planWrite(local, lastServerRef.current),
      unappliedRef.current,
      prevLocal,
      local,
    );
    unappliedRef.current = filtered.unapplied;
    const diff = filtered.diff;
    if (Object.keys(diff).length === 0) return;
    const prior = { ...(lastServerRef.current as ThemePrefs) };
    lastServerRef.current = { ...(lastServerRef.current as ThemePrefs), ...diff };
    void saveThemePrefs(supabase, diff).then((ok) => {
      if (ok || !lastServerRef.current) return;
      // Revert only fields still holding our optimistic value (a newer
      // adoption or pick may have moved them since).
      for (const key of Object.keys(diff) as Array<keyof ThemePrefs>) {
        if (lastServerRef.current[key] === diff[key]) {
          lastServerRef.current = { ...lastServerRef.current, [key]: prior[key] };
        }
      }
    });
  }, [userId, slots.dark, slots.light, modeSetting]);

  return null;
}
