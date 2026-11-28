import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { defaultOpponent, type ReportDraft } from "@scoutable/shared/lib/report-draft";
import type { ReportSeasonSnapshot } from "@scoutable/shared/lib/scouting-report";
import { isClipItem, type PlayByPlayEvent, type Playlist, type PlaylistClipItem, type PlaylistItem, type StoredMatch } from "@/types/match";
import type { ScoutingReportRun } from "@/components/editor/scouting-report-dialog";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";
import { listEventsForMatchesChecked, listMatchesByIds } from "@/lib/matches-db";
import { appendClips, getPlaylist, writePlaylistItems } from "@/lib/playlists-db";
import { announcePlaylistsChanged } from "@/lib/playlist-events";
import { enqueuePlaylistWrite } from "@/lib/playlist-write-queue";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { generateScoutingReport, type GenerateOutcome } from "@/lib/scouting-report";
import { getMyScoutingReport, type MyScoutingReport } from "@/lib/scouting-reports-db";
import { buildShipSegments, DEFAULT_POST_ROLL, DEFAULT_PRE_ROLL, demoShipBlockReason } from "@/lib/ship-clips";
import { isLocalPath } from "@/lib/stream";
import { useClipLabels } from "@/lib/use-clip-labels";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";

/** An add's outcome: the clips that went in, and the plays to place them by. */
export interface AddedClips {
  clips: PlaylistClipItem[];
  events: ReadonlyMap<string, PlayByPlayEvent>;
}

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

  // What the server holds for the playlist: every write here goes from it (lib/playlist-write-queue.ts keeps them in turn).
  const saved = useRef<{ id: string; items: PlaylistItem[] } | null>(null);
  if (playlist && saved.current?.id !== playlist.id) saved.current = { id: playlist.id, items: playlist.items };

  /**
   * Adds clips to the report's playlist (its Add clips sheet): their games and plays are read
   * first, so the report places them the moment they show; then the playlist shows them and the
   * write follows. Resolves with the clips added (none already there) and the plays of every clip
   * given, for placing them before the page has drawn them; or null when nothing could be added
   * (the plays weren't read, or the write failed: the clips are taken back).
   */
  const addClips = useCallback(async (clips: PlaylistClipItem[]): Promise<AddedClips | null> => {
    const pl = playlistRef.current;
    if (!pl) return null;
    const present = new Set(pl.items.filter(isClipItem).map(itemKey));
    const fresh = clips.filter((c) => !present.has(itemKey(c)));
    if (fresh.length === 0) return { clips: [], events: current?.events ?? new Map() };
    const newGames = [...new Set(fresh.map((c) => c.matchId))].filter((id) => !(current?.matches.has(id) ?? false));
    let games: StoredMatch[] = [];
    let plays: Record<string, PlayByPlayEvent[]> = {};
    if (newGames.length > 0) {
      try {
        const [read, checked] = await Promise.all([listMatchesByIds(newGames), listEventsForMatchesChecked(newGames)]);
        if (checked.failed.length > 0) return null;
        games = read;
        plays = checked.byMatch;
      } catch {
        return null;
      }
    }
    setState((s) => {
      if (s.playlist?.id !== pl.id) return s;
      const matches = new Map(s.matches);
      for (const m of games) matches.set(m.id, m);
      const events = new Map(s.events);
      for (const [matchId, list] of Object.entries(plays)) for (const e of list) events.set(`${matchId}:${e.eventId}`, e);
      const there = new Set(s.playlist.items.filter(isClipItem).map(itemKey));
      return { ...s, matches, events, playlist: { ...s.playlist, items: [...s.playlist.items, ...fresh.filter((c) => !there.has(itemKey(c)))] } };
    });
    let ok = true;
    await enqueuePlaylistWrite(pl.id, async () => {
      const base = saved.current?.id === pl.id ? saved.current.items : pl.items;
      try {
        const added = await appendClips({ id: pl.id, items: base }, fresh);
        saved.current = { id: pl.id, items: [...base, ...added] };
        if (added.length > 0) announcePlaylistsChanged();
      } catch (e) {
        console.error("[report] adding clips failed:", e);
        ok = false;
      }
    });
    if (!ok) {
      const failed = new Set(fresh.map(itemKey));
      setState((s) =>
        s.playlist?.id !== pl.id ? s : { ...s, playlist: { ...s.playlist, items: s.playlist.items.filter((i) => !(isClipItem(i) && failed.has(itemKey(i)))) } },
      );
      return null;
    }
    const events = new Map(current?.events ?? []);
    for (const [matchId, list] of Object.entries(plays)) for (const e of list) events.set(`${matchId}:${e.eventId}`, e);
    return { clips: fresh, events };
  }, [current]);

  /** Takes clips out of the report's playlist (an add's Undo). False when the write failed: they stay. */
  const removeClips = useCallback(async (keys: readonly string[]): Promise<boolean> => {
    const pl = playlistRef.current;
    if (!pl || keys.length === 0) return true;
    const gone = new Set(keys);
    const isGone = (i: PlaylistItem) => isClipItem(i) && gone.has(itemKey(i));
    let removed: PlaylistItem[] = [];
    setState((s) => {
      if (s.playlist?.id !== pl.id) return s;
      removed = s.playlist.items.filter(isGone);
      return { ...s, playlist: { ...s.playlist, items: s.playlist.items.filter((i) => !isGone(i)) } };
    });
    let ok = true;
    await enqueuePlaylistWrite(pl.id, async () => {
      const base = saved.current?.id === pl.id ? saved.current.items : pl.items;
      const without = base.filter((i) => !isGone(i));
      if (without.length === base.length) return;
      try {
        await writePlaylistItems(pl.id, base, without);
        saved.current = { id: pl.id, items: without };
        announcePlaylistsChanged();
      } catch (e) {
        console.error("[report] removing clips failed:", e);
        ok = false;
      }
    });
    if (!ok) setState((s) => (s.playlist?.id !== pl.id ? s : { ...s, playlist: { ...s.playlist, items: [...s.playlist.items, ...removed] } }));
    return ok;
  }, []);

  /**
   * Shows a change to one of the playlist's clips (the report's Edit clip, which saves it itself,
   * lib/use-clip-edit.ts), here and in what later writes start from.
   */
  /** The report was renamed (lib/team-report.ts, renameReportPlaylist): the page's name follows at once. */
  const setName = useCallback((name: string) => {
    setState((s) => (s.playlist ? { ...s, playlist: { ...s.playlist, name } } : s));
  }, []);

  const patchClip = useCallback((key: string, patch: Partial<PlaylistClipItem>) => {
    const apply = (list: PlaylistItem[]) => list.map((i) => (isClipItem(i) && itemKey(i) === key ? { ...i, ...patch } : i));
    setState((s) => (s.playlist ? { ...s, playlist: { ...s.playlist, items: apply(s.playlist.items) } } : s));
    if (saved.current) saved.current = { id: saved.current.id, items: apply(saved.current.items) };
  }, []);

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
    addClips,
    removeClips,
    patchClip,
    setName,
    /** Reads the labels on more games' clips (the Add clips sheet's games). */
    ensureLabels: clipLabels.ensure,
    labelHandlers: clipLabels.handlers,
  };
}
