import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { listPlaylistNames } from "@/lib/playlists-db";
import { listMyScoutingReports } from "@/lib/scouting-reports-db";
import { listReportDrafts } from "@/lib/report-drafts-db";
import { mergeReportList, type ReportListItem } from "@scoutable/shared/lib/scouting-report-list";

export type ReportListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: ReportListItem[] };

/**
 * The coach's scouting reports in the active space (lib/scouting-report-list.ts):
 * shared, ended and draft, one per playlist. Reloads when the space changes;
 * `reload` after a row's action changed one.
 */
export function useReportList(): { state: ReportListState; reload: () => void } {
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const [state, setState] = useState<ReportListState>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  const scopeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A reload keeps the rows on screen; another space starts from loading.
    const scope = `${activeOrgId}:${activeOrgIsPersonal}`;
    if (scopeRef.current !== scope) setState({ kind: "loading" });
    scopeRef.current = scope;
    Promise.all([
      listPlaylistNames(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }),
      listMyScoutingReports(),
      listReportDrafts(),
    ])
      .then(([playlists, reports, drafts]) => {
        if (!cancelled) setState({ kind: "ready", items: mergeReportList(reports, drafts, playlists, new Date()) });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, activeOrgIsPersonal, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
