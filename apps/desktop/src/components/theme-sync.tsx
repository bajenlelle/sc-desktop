/**
 * Cross-device theme sync watcher (Slack-style). Renders nothing.
 *
 * Bridges three things without owning any of them:
 * - server state: profiles.theme_dark/theme_light/theme_mode, arriving via
 *   the auth context's profile (boot + focus reloads) and a realtime
 *   postgres_changes channel on the user's own row;
 * - local theme slots: the color-theme provider (adoptColorThemes applies
 *   without side effects);
 * - the mode: next-themes' selected value — watching it here covers every
 *   mode surface (sidebar sun/moon, macOS Appearance menu) without touching
 *   them.
 *
 * Protocol (pure logic + rationale in @scoutable/shared/lib/theme-sync):
 * adoption sets lastServerRef BEFORE applying and never writes; local
 * changes write only diffs against the ref, and only after a first server
 * snapshot exists — so device defaults are never pushed, and adopt->apply
 * echoes can't loop. Failed writes revert the ref (next snapshot self-heals,
 * a re-pick retries). The realtime socket is best-effort: focus-triggered
 * profile reloads remain the guaranteed catch-up path.
 */
import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  filterUnappliedSlots,
  isTransientRealtimeFailure,
  planAdoption,
  planWrite,
  prefsFromRow,
  REALTIME_REPORT_GRACE_MS,
  unappliedSlotsFor,
  type UnappliedSlots,
  type ThemeModeSetting,
  type ThemePrefs,
} from "@scoutable/shared/lib/theme-sync";
import { saveThemePrefs } from "@scoutable/shared/lib/themes-db";
import { reportDbError } from "@scoutable/shared/lib/report";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useColorTheme } from "@/components/color-theme-provider";

function asMode(value: string | undefined): ThemeModeSetting | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

export function ThemeSync() {
  const { user, profile } = useAuth();
  const { slots, adoptColorThemes } = useColorTheme();
  const { theme, setTheme } = useTheme();
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
      themeMode: asMode(theme),
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
      if (apply.themeMode) setTheme(apply.themeMode);
    },
    [adoptColorThemes, setTheme],
  );
  const adoptRef = useRef(adopt);
  useEffect(() => {
    adoptRef.current = adopt;
  });

  // T1 — profile snapshots (boot load + throttled focus reloads).
  const profileDark = profile?.themeDark ?? null;
  const profileLight = profile?.themeLight ?? null;
  const profileMode = profile?.themeMode ?? null;
  const hasProfile = !!profile;
  useEffect(() => {
    if (!userId || !hasProfile) return;
    adoptRef.current({ themeDark: profileDark, themeLight: profileLight, themeMode: profileMode });
  }, [userId, hasProfile, profileDark, profileLight, profileMode]);

  // T2 — realtime push from the user's own profiles row.
  useEffect(() => {
    if (!userId) return;
    let reported = false;
    let reportTimer: ReturnType<typeof setTimeout> | null = null;
    const supabase = createClient();
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
        // way. Degrade silently: focus reloads still deliver changes eventually.
        if (status === "SUBSCRIBED") {
          if (reportTimer) {
            clearTimeout(reportTimer);
            reportTimer = null;
          }
          return;
        }
        if (!isTransientRealtimeFailure(status) || reported || reportTimer) return;
        const message = err?.message ?? status;
        reportTimer = setTimeout(() => {
          reportTimer = null;
          // Rejoined without re-firing this callback — nothing to report.
          if (channel.state === "joined") return;
          reported = true;
          reportDbError("themeRealtimeSubscribe", { message });
        }, REALTIME_REPORT_GRACE_MS);
      });
    return () => {
      if (reportTimer) clearTimeout(reportTimer);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // T3 — local changes (a pick in the picker, any mode toggle surface).
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
    void saveThemePrefs(createClient(), diff).then((ok) => {
      if (ok || !lastServerRef.current) return;
      // Revert only fields still holding our optimistic value (a newer
      // adoption or pick may have moved them since).
      for (const key of Object.keys(diff) as Array<keyof ThemePrefs>) {
        if (lastServerRef.current[key] === diff[key]) {
          lastServerRef.current = { ...lastServerRef.current, [key]: prior[key] };
        }
      }
    });
  }, [userId, slots.dark, slots.light, theme]);

  return null;
}
