import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { defaultOpponent, type ReportDraft } from "@scoutable/shared/lib/report-draft";
import type { ReportSeasonSnapshot } from "@scoutable/shared/lib/scouting-report";
import { isClipItem, type PlayByPlayEvent, type Playlist, type StoredMatch } from "@/types/match";
import type { ScoutingReportRun } from "@/components/editor/scouting-report-dialog";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";
import { listEventsForMatchesChecked, listMatchesByIds } from "@/lib/matches-db";
import { getPlaylist } from "@/lib/playlists-db";
import { generateScoutingReport, type GenerateOutcome } from "@/lib/scouting-report";
import { getMyScoutingReport, type MyScoutingReport } from "@/lib/scouting-reports-db";
import { buildShipSegments, DEFAULT_POST_ROLL, DEFAULT_PRE_ROLL, demoShipBlockReason } from "@/lib/ship-clips";
import { isLocalPath } from "@/lib/stream";
import { useClipLabels } from "@/lib/use-clip-labels";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";

export type ReportWorkspaceStatus = "loading" | "ready" | "missing" | "failed";

const EMPTY_EVENTS: ReadonlyMap<string, PlayByPlayEvent> = new Map();

/**
 * Everything the report page needs for one playlist, read by the page itself
 * (the playlist editor reads its own): the playlist with its clips, the games
 * they come from and their plays, whether each game's video is on this
 * computer, the coach's labels, the shared report, and the publish pipeline.
 * The same reads the Teams pages' Plays use (use-team-plays.ts), so a report
 * opened from a team costs little.
 */
export function useReportWorkspace(playlistId: string) {
  const { user, activeOrgId, activeOrgPlan, expectPlanChange } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    for: string;
    status: ReportWorkspaceStatus;
    playlist: Playlist | null;
    matches: Map<string, StoredMatch>;
    events: Map<string, PlayByPlayEvent>;
  }>({ for: "", status: "loading", playlist: null, matches: new Map(), events: new Map() });

  useEffect(() => {
    let cancelled = false;
    setState({ for: playlistId, status: "loading", playlist: null, matches: new Map(), events: new Map() });
    void (async () => {
      const playlist = await getPlaylist(playlistId);
      if (!playlist) return { status: "missing" as const, playlist: null, matches: new Map(), events: new Map() };
      const ids = [...new Set(playlist.items.filter(isClipItem).map((i) => i.matchId))];
      const [games, plays] = await Promise.all([listMatchesByIds(ids), listEventsForMatchesChecked(ids)]);
      if (plays.failed.length > 0) throw new Error(`plays not read for ${plays.failed.length} games`);
      const events = new Map<string, PlayByPlayEvent>();
      for (const [matchId, list] of Object.entries(plays.byMatch)) for (const e of list) events.set(`${matchId}:${e.eventId}`, e);
      return { status: "ready" as const, playlist, matches: new Map(games.map((m) => [m.id, m])), events };
    })()
      .then((r) => !cancelled && setState({ for: playlistId, ...r }))
      .catch((e) => {
        console.error("[report] workspace read failed:", e);
        if (!cancelled) setState({ for: playlistId, status: "failed", playlist: null, matches: new Map(), events: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId, attempt]);
  const current = state.for === playlistId ? state : null;
  const playlist = current?.playlist ?? null;
  const matchLookup = current?.matches ?? (new Map() as Map<string, StoredMatch>);
  const eventByKey: ReadonlyMap<string, PlayByPlayEvent> = current?.events ?? EMPTY_EVENTS;
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;

  // Whether each game's video is on this computer: read once the games are in, and again when the window comes back (at most every 30 s).
  const [video, setVideo] = useState<Map<string, VideoFileStatus>>(new Map());
  const [probeTick, setProbeTick] = useState(0);
  const lastProbe = useRef(0);
  useEffect(() => {
    const onFocus = () => Date.now() - lastProbe.current >= 30_000 && setProbeTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const games = useMemo(() => [...matchLookup.values()], [matchLookup]);
  useEffect(() => {
    if (games.length === 0) return;
    let cancelled = false;
    lastProbe.current = Date.now();
    void probeMatches(games).then((map) => !cancelled && setVideo(map));
    return () => {
      cancelled = true;
    };
  }, [games, probeTick]);
  const localVideoPath = useCallback(
    (matchId: string) => {
      const url = matchLookup.get(matchId)?.videoUrl;
      if (!url || !isLocalPath(url)) return null;
      const status = video.get(matchId);
      return status === "missing" || status === "unreadable" ? null : url;
    },
    [matchLookup, video],
  );

  // The coach's labels on these games, by clip.
  const gameIds = useMemo(() => [...matchLookup.keys()], [matchLookup]);
  const clipLabels = useClipLabels(activeOrgId, gameIds, "report");
  const labelNamesByClip = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [key, ids] of clipLabels.assignments) {
      const names = clipLabels.labels.filter((l) => ids.has(l.id)).map((l) => l.name);
      if (names.length > 0) out.set(key, names);
    }
    return out;
  }, [clipLabels.assignments, clipLabels.labels]);

  // The shared report, read again whenever the share sheet opens.
  const [myReport, setMyReport] = useState<MyScoutingReport | null>(null);
  const refreshReport = useCallback(() => {
    void getMyScoutingReport(playlistId)
      .then(setMyReport)
      .catch((e) => console.error("[report] shared report read failed:", e));
  }, [playlistId]);
  useEffect(refreshReport, [refreshReport]);

  const goPro = useCallback(async () => {
    trackEvent("upgrade_gate_hit", { feature: "scouting_report_limit" });
    trackEvent("upgrade_clicked", { source: "scouting_report_limit" });
    const err = await openUpgradeFlow(user?.email);
    if (err) {
      toast.error(err);
      return;
    }
    expectPlanChange();
  }, [user?.email, expectPlanChange]);

  /** Prepares the clips and previews and publishes (lib/scouting-report.ts); the share sheet drives it. */
  const run = useCallback(
    async (draft: ReportDraft, a: ScoutingReportRun, season: ReportSeasonSnapshot | null): Promise<GenerateOutcome> => {
      const pl = playlistRef.current;
      if (!pl) throw new Error("No playlist is open");
      return generateScoutingReport({
        playlist: pl,
        draft,
        eventByKey,
        shipSegments: buildShipSegments(pl, matchLookup, eventByKey),
        clipSource: (matchId) => {
          const m = matchLookup.get(matchId);
          return m?.videoUrl && m.syncPoint ? { videoPath: m.videoUrl, syncPoint: m.syncPoint } : null;
        },
        matchLabel: (id) => matchLookup.get(id)?.title ?? "",
        labelsByKey: labelNamesByClip,
        preRoll: DEFAULT_PRE_ROLL,
        postRoll: DEFAULT_POST_ROLL,
        title: draft.title ?? pl.name,
        opponent: draft.opponent ?? defaultOpponent(draft),
        season,
        allowMissing: a.allowMissing,
        signal: a.signal,
        onProgress: a.onProgress,
        // The clips now hosted: this copy of the playlist plays and counts them.
        onShipped: (uploaded) => {
          if (uploaded.length === 0) return;
          const byKey = new Map(uploaded.map((u) => [`${u.matchId}:${u.eventId}`, u.r2Url]));
          setState((s) =>
            s.playlist?.id !== pl.id
              ? s
              : {
                  ...s,
                  playlist: {
                    ...s.playlist,
                    items: s.playlist.items.map((i) => (isClipItem(i) && byKey.has(`${i.matchId}:${i.eventId}`) ? { ...i, r2Url: byKey.get(`${i.matchId}:${i.eventId}`)! } : i)),
                  },
                },
          );
        },
      });
    },
    [eventByKey, matchLookup, labelNamesByClip],
  );

  return {
    status: current?.status ?? ("loading" as ReportWorkspaceStatus),
    retry: () => setAttempt((n) => n + 1),
    playlist,
    matchLookup,
    eventByKey,
    isMultiMatch: matchLookup.size > 1,
    labels: clipLabels.labels,
    clipAssignments: clipLabels.assignments,
    labelNamesByClip,
    localVideoPath,
    myReport,
    refreshReport,
    plan: activeOrgPlan,
    goPro,
    shareDisabledReason: playlist ? demoShipBlockReason(playlist, matchLookup) : null,
    /** The editor's defaults: the report page plays and cuts clips as a freshly opened playlist does. */
    preRoll: DEFAULT_PRE_ROLL,
    postRoll: DEFAULT_POST_ROLL,
    run,
  };
}
