/**
 * The scouting reports that reached the signed-in person (their coach sent
 * them to them or their team), beside the playlists store: the Scouting
 * reports page, the card on top of My playlists, the sidebar's count and the
 * app badge all read this one list. A report's content is loaded when it is
 * opened and kept, so the reader and its clip player share one copy.
 *
 * Reading is recorded as it happens (the open, each clip watched), shown at
 * once and sent in the background: the coach's Seen by reads the same rows.
 * docs/scouting-reports.md, "On players' phones".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { InboxReport } from "@scoutable/shared/lib/scouting-report-inbox";
import { listMyInboxReports, recordReportRead } from "@scoutable/shared/lib/scouting-report-inbox-db";
import { getScoutingReport, type ScoutingReportPage } from "@scoutable/shared/lib/scouting-reports-db";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";
import { trackEvent } from "./analytics";

interface ReportsData {
  /** True until the first list has loaded. */
  loading: boolean;
  reports: InboxReport[];
  refresh: () => Promise<void>;
  /** A report's page, loaded once and kept (null while it loads). */
  loadReport: (id: string, force?: boolean) => Promise<ScoutingReportPage>;
  pageFor: (id: string) => ScoutingReportPage | null;
  /** The clip files watched in a report, by clip key. */
  watchedFor: (id: string) => ReadonlySet<string>;
  markOpened: (id: string) => void;
  markWatched: (id: string, clipKey: string) => void;
}

const ReportsContext = createContext<ReportsData | null>(null);

const EMPTY: ReadonlySet<string> = new Set();

export function ReportsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<InboxReport[]>([]);
  const [pages, setPages] = useState<Map<string, ScoutingReportPage>>(new Map());
  /** Clips watched on this device since the list loaded, so a refetch in flight can't take a tick back. */
  const localWatched = useRef<Map<string, Set<string>>>(new Map());
  const localOpened = useRef<Set<string>>(new Set());
  const lastLoadedAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    lastLoadedAt.current = Date.now();
    try {
      const rows = await listMyInboxReports(supabase);
      setReports(
        rows.map((r) => {
          const mine = localWatched.current.get(r.id);
          const watchedKeys = mine ? [...new Set([...r.watchedKeys, ...mine])] : r.watchedKeys;
          const openedAt = r.openedAt ?? (localOpened.current.has(r.id) ? new Date().toISOString() : null);
          return { ...r, watchedKeys, openedAt };
        }),
      );
    } catch {
      // Keep what's shown; the next refresh tries again.
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setReports([]);
    setPages(new Map());
    localWatched.current = new Map();
    localOpened.current = new Set();
    setLoading(true);
    refresh();
  }, [refresh]);

  // Back to the foreground: what's listed may have changed (throttled like the playlists store).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastLoadedAt.current > 30_000) refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loadReport = useCallback(async (id: string, force = false) => {
    if (!force) {
      const kept = pagesRef.current.get(id);
      if (kept) return kept;
    }
    const page = await getScoutingReport(supabase, id);
    setPages((prev) => new Map(prev).set(id, page));
    return page;
  }, []);

  const pageFor = useCallback((id: string) => pages.get(id) ?? null, [pages]);

  const watchedFor = useCallback(
    (id: string) => {
      const r = reports.find((x) => x.id === id);
      return r ? new Set(r.watchedKeys) : (localWatched.current.get(id) ?? EMPTY);
    },
    [reports],
  );

  const markOpened = useCallback((id: string) => {
    if (!localOpened.current.has(id)) {
      localOpened.current.add(id);
      trackEvent("scouting_report_read", {});
    }
    setReports((prev) => prev.map((r) => (r.id === id && !r.openedAt ? { ...r, openedAt: new Date().toISOString() } : r)));
    // A report that doesn't reach this person (an old link) says so; nothing to show for it.
    recordReportRead(supabase, id).catch(() => {});
  }, []);

  const markWatched = useCallback((id: string, clipKey: string) => {
    const mine = localWatched.current.get(id) ?? new Set<string>();
    if (mine.has(clipKey)) return;
    mine.add(clipKey);
    localWatched.current.set(id, mine);
    setReports((prev) =>
      prev.map((r) => (r.id === id && !r.watchedKeys.includes(clipKey) ? { ...r, watchedKeys: [...r.watchedKeys, clipKey] } : r)),
    );
    recordReportRead(supabase, id, clipKey).catch(() => {});
  }, []);

  const value = useMemo<ReportsData>(
    () => ({ loading, reports, refresh, loadReport, pageFor, watchedFor, markOpened, markWatched }),
    [loading, reports, refresh, loadReport, pageFor, watchedFor, markOpened, markWatched],
  );
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsData {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error("useReports outside ReportsProvider");
  return ctx;
}
