import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { sideOf } from "@scoutable/shared/lib/team-video";
import { teamPath } from "@/components/entity-link";
import { useLeagues } from "@/lib/use-leagues";
import { useGameTeams } from "./use-game-teams";
import { Check, Play, Tag, VideoOff } from "lucide-react";
import { eventLabel, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { GAME_MOMENTS, afterTimeoutPlays, gameFlow, gameMoments, onCourtStints, scoreAfter, type GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_GAME_FILTERS, gameFiltersActive, gameRows, keepPlay, type GameFilters, type GameRow } from "@scoutable/shared/lib/game-list";
import { playerKey, playersByTeam } from "@scoutable/shared/lib/clip-filters";
import { activeGroups } from "@scoutable/shared/lib/play-filters";
import { buildGameTimeline, momentAt, PERIOD_LEAD_SECONDS, visibleOrder, type TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { videoLooksCut } from "@scoutable/shared/lib/period-sync";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { labelKeySlot } from "@scoutable/shared/lib/label-keys";
import { clickSelection, extendSelection, moveFocus, pruneSelection, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { defaultPreRoll } from "@scoutable/shared/lib/provider";
import { cutShiftSeconds, partChecked, partOf } from "@scoutable/shared/lib/sync-check";
import { applyPresetFilters, presetLabelsGone, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { PlayerStage, type PlayerStageHandle } from "@/components/editor/player-stage";
import { PlaysSelectionBar } from "@/components/plays/plays-selection-bar";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import { usePlayLabelKeys } from "@/components/plays/use-play-label-keys";
import { useStageFit } from "@/components/plays/use-stage-fit";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { FilterPresetsMenu } from "@/components/filter-presets-menu";
import { Page } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { quietControl } from "@/components/ui/filter-button";
import { Callout } from "@/components/ui/group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { GAMES_FALLBACK, GameTitle } from "@/components/game/game-toolbar-parts";
import { recallGamePosition, recallGameView, rememberGamePosition, rememberGameView } from "@/lib/game-tabs";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { togglePlayerMuted } from "@/lib/player-sound";
import { getGameTimelineTipSeen, setGameTimelineTipSeen } from "@/lib/prefs";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { useVideoCuts } from "@/lib/video-cut-scan";
import { useClipLabels } from "@/lib/use-clip-labels";
import { useFilterPresets } from "@/lib/use-filter-presets";
import { useGameMarks } from "@/lib/use-game-marks";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { videoBasename, type VideoFileStatus } from "@/lib/video-probe";
import { cn } from "@/lib/utils";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";
import type { VideoJump } from "@scoutable/shared/lib/video-jumps";
import { CollectControl } from "./collect-control";
import { GameFilterBar, type GamePerson } from "./game-filters";
import { GameLabelKeys } from "./game-label-keys";
import { GameNowBar, betweenPlays } from "./game-now-bar";
import { GameSyncBar } from "./game-sync-bar";
import { GamePlayList } from "./game-play-list";
import { playDetails } from "./game-play-row";
import { GamePlayMenuContent } from "./game-play-menu";
import { GAME_SYNC_ROW_HEIGHT, GAME_TIMELINE_HEIGHT, GameTimelineStrip, type GameTimelineHandle, type StripLandmark, type StripSyncPart } from "./game-timeline-strip";
import { SyncCue } from "./sync-cue";
import { SyncFindStrip } from "./sync-find-strip";
import { SyncFixesMenu } from "./sync-fixes-menu";
import { useCollect, type CollectScope } from "./use-collect";
import { useGamePlayback } from "./use-game-playback";
import { useGameSync } from "./use-game-sync";
import { useWheelScrub } from "./use-wheel-scrub";

/** The players' remembered speed, shared with the playlist watch view. */
const SPEED_KEY = "scoutable_watch_speed";
/** Under the stage, in its column: the Now bar with its air, then the timeline. */
const UNDER_STAGE = 52 + GAME_TIMELINE_HEIGHT;
/** The sync's panel over the footage (game-sync-bar.tsx: 104 px with its two lines of what to do) takes the Now bar's 52 under it, and this much more. */
const SYNC_PANEL_EXTRA = 52;
/** Where a game opens: this long before tip-off, so the jump ball is seen. */
const TIPOFF_LEAD_SECONDS = 5;

function readSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

/** A stage-sized panel that says why there is no footage and what to do about it. */
function StagePanel({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="dark absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/85 p-6 text-center text-white" onClick={(e) => e.stopPropagation()}>
      <VideoOff className="mb-1 size-6 text-white/60" aria-hidden />
      <p className="text-headline">{title}</p>
      <p className="max-w-sm text-callout text-white/70">{body}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

/**
 * The game page's Game view: the whole game on one page. The player is one
 * column: the footage with its own scrubber, the Now bar under it, and under
 * that the game's timeline at the footage's width, the story of the score and
 * a way through the game. Beside it the plays, in a list that follows
 * playback (docs/game-view.md). From here a coach collects plays into a
 * playlist and labels them without leaving the game.
 *
 * Everything but the footage works without footage: a game whose video
 * isn't on this computer, or isn't synced yet, still shows its score graph,
 * its plays and its moments, and its plays can still be collected and
 * labelled.
 */

/** "The video has 2 jumps in it (Q1 6:58, Q2 1:10). Plays after a jump may be off." */
function jumpWords(jumps: readonly VideoJump<PlayByPlayEvent>[]): string {
  const where = jumps
    .slice(0, 3)
    .map((j) => [periodLabel(j.period), j.after.gameClockTime ? formatGameClock(j.after.gameClockTime).replace(/^0(\d:)/, "$1") : null].filter(Boolean).join(" "))
    .join(", ");
  const more = jumps.length > 3 ? ", …" : "";
  return jumps.length === 1
    ? `The video has a jump in it (${where}). Plays after it may be off.`
    : `The video has ${jumps.length} jumps in it (${where}${more}). Plays after a jump may be off.`;
}

export function GameWatchView({
  match,
  videoStatus,
  viewSwitch,
  entry,
  startEventId,
  startFilters,
  autoPlay = false,
  onOpenDetails,
  onSyncChange,
}: {
  match: StoredMatch;
  /** "ok": the video plays here. "missing" / "unreadable": a local file that doesn't. "none": no video linked. */
  videoStatus: VideoFileStatus | "none";
  viewSwitch: ReactNode;
  /** The open games' tabs are the row above the toolbar (there with one game too). */
  /** How the coach got here, for analytics. */
  entry: string;
  /** A play to open on (a link from elsewhere). */
  startEventId: number | null;
  /** Filters to open with instead of the remembered ones: the plays behind a number in the Stats view. */
  startFilters?: GameFilters | null;
  /** Play from the start play at once: a number in Stats was clicked to watch its plays. */
  autoPlay?: boolean;
  onOpenDetails: (opts?: { openQuarters?: boolean }) => void;
  /** The game's sync was changed here (Check sync, Fix sync): the page's copy of the game follows. */
  onSyncChange: (next: SyncPoint) => void;
}) {
  const { user, activeOrgId, activeOrgIsPersonal } = useAuth();
  const video = usePersistentVideo();
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const timelineHandle = useRef<GameTimelineHandle | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const playerFs = usePlayerFullscreen();
  const [speed, setSpeedState] = useState(readSpeed);
  const [duration, setDuration] = useState<number | null>(null);
  // How this game was left on an earlier visit; a link to a play opens without it, so the play is in the list.
  const [remembered] = useState(() => (startEventId === null ? recallGameView(match.id) : null));
  // The Stats view's plays come with their own filter, also when they open on a play.
  const [filters, setFilters] = useState<GameFilters>(() => startFilters ?? remembered?.filters ?? EMPTY_GAME_FILTERS);
  const [zoomPeriod, setZoomPeriod] = useState<number | null>(() => remembered?.zoomPeriod ?? null);
  useEffect(() => rememberGameView(match.id, { filters, zoomPeriod }), [match.id, filters, zoomPeriod]);
  const [labelPickerFor, setLabelPickerFor] = useState<string | null>(null);
  // The play the Now bar's label picker was opened for: it stays that play however long the choosing takes.
  const [nowLabelFor, setNowLabelFor] = useState<TimedPlay | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [followSignal, setFollowSignal] = useState(0);
  const [reveal, setReveal] = useState<{ key: string; nonce: number } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const [tipSeen, setTipSeen] = useState(() => getGameTimelineTipSeen(user?.id));
  const searchRef = useRef<HTMLInputElement | null>(null);

  const synced = !!match.syncPoint;
  const src = videoStatus === "ok" && match.videoUrl && synced ? (isLocalPath(match.videoUrl) ? streamFileSrc(match.videoUrl) : match.videoUrl) : null;
  const footage = src !== null;

  // ---- The game, read ------------------------------------------------------
  const { marks, reading: readingMarks } = useGameMarks(match);
  const flow = useMemo(() => gameFlow(match.events), [match.events]);
  const timeline = useMemo(
    () =>
      buildGameTimeline({
        matchId: match.id,
        events: match.events,
        sync: match.syncPoint,
        marks,
        durationSeconds: footage ? duration : null,
        preRoll: defaultPreRoll(match),
      }),
    [match, marks, duration, footage],
  );
  const moments = useMemo(() => gameMoments(flow, marks), [flow, marks]);
  const playByEvent = useMemo(() => new Map(timeline.plays.map((p) => [p.event.eventId, p])), [timeline]);
  const teams = useMemo(() => ({ home: match.homeTeam.name || "Home", away: match.awayTeam.name || "Away" }), [match.homeTeam.name, match.awayTeam.name]);
  const stripTeams = useMemo(
    () => ({ home: { name: teams.home, color: match.homeTeam.color }, away: { name: teams.away, color: match.awayTeam.color } }),
    [teams, match.homeTeam.color, match.awayTeam.color],
  );

  const people = useMemo(() => {
    const byId = new Map<number, GamePerson>();
    for (const e of match.events) {
      if (!e.player || byId.has(e.player.playerId)) continue;
      const name = `${e.player.firstName} ${e.player.familyName}`.trim();
      if (!name) continue;
      byId.set(e.player.playerId, { id: e.player.playerId, key: playerKey(e) ?? `name:${name}`, name, number: e.player.pno ? String(e.player.pno) : null, side: e.player.teamNumber === 2 ? 2 : 1 });
    }
    return [...byId.values()].sort((a, b) => a.side - b.side || (Number(a.number) || 999) - (Number(b.number) || 999));
  }, [match.events]);

  // The Filter popover's players: by team, keyed as every list keys them (playerKey).
  const playerGroups = useMemo(() => playersByTeam(match.events), [match.events]);

  const momentCounts = useMemo(() => {
    const counts = Object.fromEntries(GAME_MOMENTS.map((m) => [m, 0])) as Record<GameMoment, number>;
    for (const set of moments.values()) for (const m of set) counts[m]++;
    return counts;
  }, [moments]);

  // ---- Labels, the playlist, the filters ------------------------------------
  const labelGames = useMemo(() => [match.id], [match.id]);
  const labels = useClipLabels(activeOrgId, labelGames, "game_view");
  // Presets are shared with Add clips. One keeps plays, shot types, situations and labels, never the
  // team or players (lib/filter-presets.ts): applying it leaves the Both/home/away control, the chosen
  // players, "on court", the search, the moment and the quarters as they are.
  const presets = useFilterPresets(activeOrgId, "game_view");
  const labelIds = useMemo(() => labels.labels.map((l) => l.id), [labels.labels]);
  const applyPreset = (p: FilterPreset) => {
    setFilters((f) => ({ ...f, play: applyPresetFilters(f.play, p.filters, labelIds) }));
    presets.applied(p);
    if (presetLabelsGone(p.filters, labelIds)) toast("This preset's labels no longer exist, so they weren't applied");
  };
  const collectScope = useMemo<CollectScope>(
    () => ({ key: match.id, games: [match], title: match.title, surface: "game_view" }),
    [match],
  );
  const collect = useCollect({ scope: collectScope, orgId: activeOrgId, includeUnscoped: activeOrgIsPersonal });
  // A play's team, from its row's menu: "Go to {team}" (docs/navigation.md), once the season says where its page is.
  const navigate = useNavigate();
  const gameTeams = useGameTeams(match, useLeagues());
  const goToTeamOf = (event: PlayByPlayEvent) => {
    const side = sideOf(event);
    const team = side === 1 ? gameTeams.home : side === 2 ? gameTeams.away : null;
    if (!team) return undefined;
    const name = (side === 1 ? match.homeTeam.name : match.awayTeam.name) || (side === 1 ? "Home" : "Away");
    return [{ label: `Go to ${name}`, onSelect: () => navigate(teamPath(team), { state: { from: "game" } }) }];
  };

  // One player chosen: their stints on the floor, for the strip and the "while on the floor" switch.
  const chosenPlayer = filters.play.players.size === 1 ? (people.find((p) => p.key === [...filters.play.players][0]) ?? null) : null;
  const stints = useMemo(() => (chosenPlayer ? onCourtStints(flow, chosenPlayer.id) : null), [flow, chosenPlayer]);
  const onCourtIds = useMemo(() => {
    if (!filters.onCourt || !stints || stints.length === 0) return null;
    const ids = new Set<number>();
    for (const s of stints) {
      const from = flow.indexOf.get(s.fromEventId) ?? 0;
      const to = flow.indexOf.get(s.toEventId) ?? -1;
      for (let i = from; i <= to; i++) ids.add(flow.order[i].eventId);
    }
    return ids;
  }, [filters.onCourt, stints, flow]);

  const keep = useMemo(() => keepPlay(filters, { moments, labelsOf: labels.labelsOf, onCourtIds }), [filters, moments, labels.labelsOf, onCourtIds]);
  const order = useMemo(() => visibleOrder(timeline, keep), [timeline, keep]);
  const rows = useMemo(() => gameRows({ timeline, keep, filters, flow, marks }), [timeline, keep, filters, flow, marks]);
  const filtered = gameFiltersActive(filters);
  const addable = useMemo(() => order.filter((i) => collect.statusOf(timeline.plays[i].key) === "none").length, [order, timeline, collect]);

  // ---- Playback --------------------------------------------------------------
  const trackSeek = useCallback((via: string, kind: string, period: number | null) => {
    trackEvent("game_view_seeked", { via, kind, period });
  }, []);
  const playback = useGamePlayback({ video, plays: timeline.plays, order, allOrder: timeline.byTime, bands: timeline.bands, canPlay: footage, onSeek: trackSeek });
  // The play on screen, whatever the list is filtered to: the Now bar names it, A adds it, G labels it.
  const nowPlay = useMemo(() => (playback.nowKey ? (timeline.plays.find((p) => p.key === playback.nowKey) ?? null) : null), [timeline, playback.nowKey]);
  const refollow = useCallback(() => setFollowSignal((n) => n + 1), []);
  /** Brings a row to the top of the list: the quarter or the marker a key jumped to. */
  const revealRow = useCallback((key: string) => setReveal((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 })), []);

  const playPlay = useCallback(
    (play: TimedPlay, via = "row") => {
      playback.playPlay(play, via);
      refollow();
    },
    [playback, refollow],
  );
  const seekTo = useCallback(
    (t: number, via: string, kind = "time", play = false) => {
      trackSeek(via, kind, null);
      playback.seekTo(t, { play, jump: true });
      refollow();
    },
    [playback, trackSeek, refollow],
  );

  // ---- The sync, checked and fixed on this video (docs/game-view.md, "Sync") -----------------
  const syncSeek = useCallback(
    (t: number, play: boolean) => {
      if (!play) video.pause();
      playback.seekTo(t, { play, jump: true });
      refollow();
    },
    [playback, video, refollow],
  );
  // The recording's hard cuts, found in the background and shared by its fingerprint (lib/video-cut-scan.ts).
  const { cuts } = useVideoCuts(footage && match.syncPoint && match.videoUrl ? match.videoUrl : null);
  const sync = useGameSync({ match, timeline, flow, video, duration, footage, seek: syncSeek, onSyncChange, cuts });

  // ---- The selection: plays picked to add together, as the editor's list picks clips (list-selection.ts) ----
  // The anchor is where Shift ranges grow from, the focus where the last Shift move landed; a plain arrow lets go of both.
  const anchorRef = useRef<string | null>(null);
  const extendFocusRef = useRef<string | null>(null);
  const orderKeys = useMemo(() => order.map((i) => timeline.plays[i].key), [order, timeline]);
  const playByKey = useMemo(() => new Map(timeline.plays.map((p) => [p.key, p])), [timeline]);
  /** The selected plays in list order. */
  const selectedPlays = useMemo(() => orderKeys.filter((k) => selected.has(k)).map((k) => playByKey.get(k)!), [orderKeys, selected, playByKey]);
  // A filter that hides a play takes it out of the selection: what is picked is always what is listed.
  useEffect(() => setSelected((prev) => pruneSelection(prev, orderKeys)), [orderKeys]);

  /** A click on a row: plain plays it (keeping the selection only when the row is in it), ⌘ toggles, Shift ranges. */
  function onPress(play: TimedPlay, { shift, toggle }: { shift: boolean; toggle: boolean }) {
    const next = clickSelection({
      order: orderKeys,
      selected,
      anchor: anchorRef.current ?? playback.activeKey,
      focus: extendFocusRef.current,
      key: play.key,
      shift,
      toggle,
    });
    setSelected(next.selected);
    anchorRef.current = next.anchor;
    extendFocusRef.current = next.focus;
    if (!shift && !toggle) playPlay(play);
  }
  /** Shift+arrows: select from the anchor to the play there, and play it. */
  function extendTo(move: FocusMove) {
    const from = extendFocusRef.current ?? playback.activeKey;
    const to = moveFocus(orderKeys, from, move);
    if (to === null) return;
    const shown = (key: string | null): key is string => key !== null && orderKeys.includes(key);
    const anchor = shown(anchorRef.current) ? anchorRef.current : shown(from) ? from : to;
    setSelected((prev) => extendSelection({ order: orderKeys, selected: prev, anchor, previousFocus: shown(from) ? from : null, focus: to }));
    anchorRef.current = anchor;
    extendFocusRef.current = to;
    if (to !== playback.activeKey) playPlay(playByKey.get(to)!, "key");
  }
  function clearSelection() {
    setSelected(new Set());
    anchorRef.current = null;
    extendFocusRef.current = null;
  }
  // Playback drives the current row: once it moves on (playing through, a marker, a quarter, the timeline), Shift+arrows
  // extend from the play it reached, not from where the last click or Shift move left off.
  useEffect(() => {
    if (playback.activeKey !== extendFocusRef.current) {
      anchorRef.current = null;
      extendFocusRef.current = null;
    }
  }, [playback.activeKey]);

  const setSpeed = useCallback((next: number) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Remembering the speed is a convenience.
    }
  }, []);

  // The file's own length, once the video knows it.
  useEffect(() => {
    const update = () => setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("durationchange", update);
    update();
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("durationchange", update);
    };
  }, [video]);

  // Where the game opens, once: the play a link named, else where this visit's
  // last look left it, else just before tip-off. Paused, except for plays
  // opened from a number in Stats (`autoPlay`), which play at once.
  const resumeAt = useRef(recallGamePosition(match.id));
  const placed = useRef(false);
  /** The period the game opened in (null before tip-off, in a break or after): arriving there isn't a crossing. */
  const placedPeriod = useRef<number | null>(null);
  const firstBandStart = timeline.bands[0]?.start ?? null;
  useEffect(() => {
    if (!footage || placed.current || duration === null) return;
    placed.current = true;
    const linked = startEventId !== null ? playByEvent.get(startEventId) : undefined;
    const at = linked ? linked.start : (resumeAt.current ?? (firstBandStart !== null ? Math.max(0, firstBandStart - TIPOFF_LEAD_SECONDS) : 0));
    const to = Math.min(at, Math.max(0, duration - 1));
    const opened = momentAt(timeline, to, PERIOD_LEAD_SECONDS);
    placedPeriod.current = opened.phase === "live" ? opened.period : null;
    // A linked play is held as the current one through its lead-in, as a click on its row holds it: the play the
    // coach asked for is what is lit and named, not the one before it.
    if (linked) playback.seekTo(to, { hold: linked, play: autoPlay });
    else video.currentTime = to;
    // `playback` is stable enough: the placement runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footage, duration, startEventId, playByEvent, firstBandStart, timeline, video]);

  // Remember where the coach was, for coming back from Details or the editor.
  // Kept as playback goes: by the time this view is torn down the video has
  // already given its decoder back and no longer knows where it was.
  useEffect(() => {
    if (!footage) return;
    let last = 0;
    let written = 0;
    const save = () => {
      if (last > 0) rememberGamePosition(match.id, last);
    };
    const note = () => {
      if (!placed.current || video.currentTime <= 0) return;
      last = video.currentTime;
      const now = performance.now();
      if (now - written > 3000) {
        written = now;
        save();
      }
    };
    video.addEventListener("timeupdate", note);
    video.addEventListener("seeked", note);
    video.addEventListener("pause", save);
    return () => {
      video.removeEventListener("timeupdate", note);
      video.removeEventListener("seeked", note);
      video.removeEventListener("pause", save);
      save();
    };
  }, [video, footage, match.id]);

  // ---- Full screen -----------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    if (!playerFs.active && !footage) return;
    playerFs.toggle();
  }, [playerFs, footage]);
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("player-fullscreen-toggle", onToggle);
    return () => window.removeEventListener("player-fullscreen-toggle", onToggle);
  }, [toggleFullscreen]);
  const fsRef = useRef(playerFs);
  fsRef.current = playerFs;
  useEffect(
    () => () => {
      if (fsRef.current.active) void fsRef.current.exit();
    },
    [],
  );

  // ---- Analytics -------------------------------------------------------------
  const closing = useRef({ clips: 0, labels: 0, played: 0, since: null as number | null });
  closing.current.clips = collect.addedTotal;
  closing.current.labels = labels.applied;
  useEffect(() => {
    trackEvent("game_view_opened", {
      plays: timeline.plays.length,
      synced,
      video: videoStatus === "ok" && match.videoUrl && !isLocalPath(match.videoUrl) ? "remote" : videoStatus,
      score: flow.source,
      timeouts: marks?.timeouts.length ?? 0,
      entry,
      restored: !!remembered && (gameFiltersActive(remembered.filters) || remembered.zoomPeriod !== null),
      is_demo: !!match.isDemo,
    });
    const c = closing.current;
    const onPlay = () => {
      c.since = performance.now();
    };
    const onPause = () => {
      if (c.since !== null) c.played += (performance.now() - c.since) / 1000;
      c.since = null;
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      onPause();
      trackEvent("game_view_closed", { seconds_played: Math.round(c.played), clips_added: c.clips, labels_applied: c.labels });
    };
    // Once per visit: what the game looked like when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A filter change is one event once the coach has stopped changing it.
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      trackEvent("game_view_filtered", {
        team: filters.team,
        moment: filters.play.moment,
        groups: activeGroups(filters.play),
        on_court: filters.onCourt,
        picked: filters.picked !== null,
        visible: order.length,
      });
    }, 800);
    return () => window.clearTimeout(timer);
    // The count rides along; it isn't what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // ---- Moving through the game ----------------------------------------------
  /**
   * The places Page Up and Page Down stop at: each period's start, each timeout's restart, each run's first basket.
   * `hold` is the play a place leads to (the play out of a timeout, a run's first basket): the play on screen from
   * the moment the video goes there, whichever way it goes (a key, the timeline, the row in the list).
   */
  const jumps = useMemo(() => {
    const list: { time: number; kind: string; period: number; row: string; hold: TimedPlay | null }[] = [];
    for (const b of timeline.bands) list.push({ time: Math.max(0, b.start - PERIOD_LEAD_SECONDS), kind: "period", period: b.period, row: `period:${b.period}`, hold: null });
    const ledTo = new Map(afterTimeoutPlays(flow, marks).map(({ timeout, eventId }) => [timeout.eventId, eventId === null ? null : (playByEvent.get(eventId) ?? null)]));
    for (const t of marks?.timeouts ?? []) {
      const at = timeline.timeOf(t.resumeRealWorldTime ?? t.realWorldTime, t.period);
      if (at !== null) list.push({ time: Math.max(0, at - 3), kind: "timeout", period: t.period, row: `timeout:${t.eventId}`, hold: ledTo.get(t.eventId) ?? null });
    }
    for (const run of flow.runs) {
      const first = playByEvent.get(run.fromEventId);
      if (first) list.push({ time: first.start, kind: "run", period: run.period, row: `run:${run.fromEventId}`, hold: first });
    }
    return list.sort((a, b) => a.time - b.time);
  }, [timeline, marks, flow, playByEvent]);

  const jump = useCallback(
    (direction: 1 | -1) => {
      if (!footage) return;
      const now = video.currentTime;
      const target = direction > 0 ? jumps.find((j) => j.time > now + 0.5) : [...jumps].reverse().find((j) => j.time < now - 3);
      if (!target) return;
      trackSeek("key", target.kind, target.period);
      playback.seekTo(target.time, { play: !video.paused, jump: true, hold: target.hold });
      refollow();
      revealRow(target.row);
    },
    [footage, video, jumps, playback, trackSeek, refollow, revealRow],
  );

  /**
   * A click on a run or a timeout on the timeline, with its row shown in the list. A run starts its first basket
   * exactly as its row in the list does: from that basket's pre-roll with footage, chosen without. A timeout goes to
   * the place Page Down stops at for it, with the play it leads to as the play on screen. The video is asked for
   * that place once: the press that made the click left it where it was.
   */
  const toLandmark = useCallback(
    (landmark: StripLandmark) => {
      const row = `${landmark.kind}:${landmark.id}`;
      revealRow(row);
      if (landmark.kind === "run") {
        const first = playByEvent.get(landmark.id);
        if (!first) return;
        playback.playPlay(first, "timeline", "run");
        refollow();
        return;
      }
      const target = jumps.find((j) => j.row === row);
      if (!target || !footage) return;
      trackSeek("timeline", target.kind, target.period);
      playback.seekTo(target.time, { play: true, jump: true, hold: target.hold });
      refollow();
    },
    [footage, jumps, playByEvent, playback, trackSeek, refollow, revealRow],
  );
  /** Where that click goes in the video, for the line under the track. */
  const landmarkTime = useCallback(
    (landmark: StripLandmark) => (footage ? (jumps.find((j) => j.row === `${landmark.kind}:${landmark.id}`)?.time ?? null) : null),
    [footage, jumps],
  );

  const toPeriod = useCallback(
    (period: number, via: string) => {
      const band = timeline.bands.find((b) => b.period === period);
      if (!band || !footage) return;
      trackSeek(via, "period", period);
      playback.seekTo(Math.max(0, band.start - PERIOD_LEAD_SECONDS), { play: true, jump: true });
      refollow();
      revealRow(`period:${period}`);
    },
    [timeline, footage, playback, trackSeek, refollow, revealRow],
  );

  const onMarker = useCallback(
    (row: Exclude<GameRow, { kind: "play" } | { kind: "period" }>) => {
      if (row.kind === "run") {
        const first = playByEvent.get(row.run.fromEventId);
        if (first) playPlay(first, "marker");
        return;
      }
      if (!footage) return;
      if (row.kind === "timeout") {
        // The same place, and the same play on screen, as its mark on the timeline and Page Down give.
        const target = jumps.find((j) => j.row === row.key);
        if (!target) return;
        trackSeek("marker", "timeout", null);
        playback.seekTo(target.time, { play: true, jump: true, hold: target.hold });
        refollow();
        return;
      }
      const band = timeline.bands.find((b) => b.period === row.period);
      if (band) seekTo(Math.max(band.start, band.end - 10), "marker", "period", true);
    },
    [footage, timeline, jumps, playByEvent, playback, playPlay, seekTo, trackSeek, refollow],
  );

  // Zoomed into a quarter, the strip turns the page when playback does.
  const livePeriod = playback.moment?.phase === "live" ? playback.moment.period : null;
  // A zoom brought back from an earlier visit stays: where the game opens isn't playback crossing a period.
  const zoomRestored = useRef(zoomPeriod !== null);
  useEffect(() => {
    if (livePeriod === null) return;
    if (zoomRestored.current) {
      // Before the game is placed the playhead isn't where it opens yet.
      if (!placed.current) return;
      zoomRestored.current = false;
      if (livePeriod === placedPeriod.current) return;
    }
    if (zoomPeriod !== null && livePeriod !== zoomPeriod) setZoomPeriod(livePeriod);
    // Only playback crossing into another period turns the page, not the coach choosing one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePeriod]);

  const dismissTip = useCallback(() => {
    if (tipSeen) return;
    setTipSeen(true);
    setGameTimelineTipSeen(user?.id);
  }, [tipSeen, user?.id]);

  // ---- Adding and labelling the play on screen ---------------------------------
  const between = footage && playback.moment !== null && playback.moment.phase !== "live";
  // A quarter has no play of its own until its first one: the last play of the quarter before isn't "now".
  const stale =
    footage && nowPlay !== null && nowPlay.reach === "in" && playback.moment?.phase === "live" && playback.moment.period !== null && nowPlay.event.period < playback.moment.period;
  const current = between || stale ? null : nowPlay;
  // A picker that has to open (no playlist chosen yet) grows from the control that asked: the Now bar's Add
  // (for the A key too), the "Add all" button, a row's plus.
  const addCurrent = useCallback(() => {
    if (current && collect.statusOf(current.key) === "none") collect.add([current], "now_bar", filters.play.moment, addButtonRef.current);
  }, [current, collect, filters.play.moment]);
  const addAll = useCallback(
    (anchor: HTMLElement) => {
      const plays = order.map((i) => timeline.plays[i]).filter((p) => collect.statusOf(p.key) === "none");
      collect.add(plays, "bulk", filters.play.moment, anchor);
    },
    [order, timeline, collect, filters.play.moment],
  );
  const addOne = useCallback((play: TimedPlay, anchor: HTMLElement) => collect.add([play], "row", filters.play.moment, anchor), [collect, filters.play.moment]);
  const openRowLabels = useCallback((play: TimedPlay) => setLabelPickerFor(play.key), []);

  // The label keys (⌥1–⌥9, ⇧G, Option held) act on the play on screen, as on Teams' Plays.
  const labelTargets = useCallback(
    () => (current ? [{ key: current.key, matchId: match.id, eventId: current.event.eventId }] : []),
    [current, match.id],
  );
  const labelsOfPlay = useCallback((key: string) => labels.assignments.get(key), [labels.assignments]);
  const openNowPicker = useCallback(() => setNowLabelFor(current), [current]);
  const {
    lastLabel,
    labelAgain,
    labelByKey,
    keysShown: labelKeysShown,
  } = usePlayLabelKeys({
    scope: "game",
    labels: labels.labels,
    labelsOf: labelsOfPlay,
    targets: labelTargets,
    handlers: labels.handlers,
    openPicker: openNowPicker,
  });

  // Choosing a label holds the footage: the label goes on the play it was asked for, and nothing
  // goes by unseen meanwhile. It carries on by itself when the picker closes.
  const labelling = nowLabelFor !== null || labelPickerFor !== null;
  const resumeAfterLabel = useRef(false);
  useEffect(() => {
    if (!footage) return;
    if (labelling) {
      // A swipe still coming to rest is over: the footage holds from here, and carries on when the picker closes.
      timelineHandle.current?.endScrub();
      if (!video.paused) {
        resumeAfterLabel.current = true;
        video.pause();
      }
    } else if (resumeAfterLabel.current) {
      resumeAfterLabel.current = false;
      video.play().catch(() => {});
    }
  }, [labelling, footage, video]);

  const labelPicker = (play: TimedPlay, trigger: ReactElement, open: boolean, onOpenChange: (open: boolean) => void, side: "top" | "bottom") => (
    <LabelPickerPopover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      side={side}
      align="end"
      labels={labels.labels}
      assignedAllIds={new Set(labels.assignments.get(play.key) ?? [])}
      onToggle={(labelId, state) => labels.handlers.onToggleClip(match.id, play.event.eventId, labelId, state)}
      onCreate={labels.handlers.onCreate}
      onRename={labels.handlers.onRename}
      onRecolor={labels.handlers.onRecolor}
      onDelete={labels.handlers.onDelete}
      onSetKey={labels.handlers.onSetKey}
      onSeedDefaults={labels.handlers.onSeedDefaults}
    />
  );
  const renderRowLabelPicker = (play: TimedPlay) =>
    labelPicker(
      play,
      <button
        type="button"
        aria-label="Label this play"
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-fill-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-selection [&_svg]:size-3.5"
      >
        <Tag />
      </button>,
      true,
      (open) => {
        if (!open) setLabelPickerFor(null);
      },
      "bottom",
    );

  // ---- Keys ---------------------------------------------------------------------
  useKeyScope("game", true);
  useHotkeys("game", (e) => {
    // While a play is being checked or found, Return answers and Escape steps back out; the keys that would leave
    // the play (another play, a quarter, adding, labelling) rest, and the ones that move the footage work as ever.
    if (sync.active) {
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (plain && (e.code === "Enter" || e.code === "NumpadEnter")) {
        // A focused button answers for itself.
        if (!(e.target instanceof HTMLElement && e.target.closest("button, a"))) {
          e.preventDefault();
          sync.actions.primary();
        }
        return;
      }
      if (plain && e.code === "Escape" && !playerFs.active) {
        e.preventDefault();
        sync.actions.escape();
        return;
      }
      const moving = resolvePlayerKey(e);
      if (moving === "replay" && sync.mode.kind === "ask") {
        e.preventDefault();
        sync.actions.replay();
        return;
      }
      // Finding a moment wants a finer step than moving through a game does: a second, not two.
      if (sync.mode.kind === "find" && (moving === "nudge-back" || moving === "nudge-forward")) {
        e.preventDefault();
        playback.seekTo(video.currentTime + (moving === "nudge-back" ? -1 : 1));
        refollow();
        return;
      }
      const stays = moving !== null && (moving === "toggle-play" || moving === "toggle-mute" || moving === "fullscreen" || moving === "escape" || moving.startsWith("nudge-") || moving.startsWith("shuttle-"));
      if (!stays) return;
    }
    // The view's own keys: add, label, the markers, the quarters, the player search.
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.code === "KeyA") {
        e.preventDefault();
        addCurrent();
        return;
      }
      if (e.code === "KeyG") {
        e.preventDefault();
        if (current) setNowLabelFor(current);
        return;
      }
      if (e.code === "PageDown" || e.code === "PageUp") {
        e.preventDefault();
        jump(e.code === "PageDown" ? 1 : -1);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        toPeriod(Number(digit[1]), "quarter");
        return;
      }
    }
    if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyG") {
      e.preventDefault();
      labelAgain();
      return;
    }
    const labelKey = labelKeySlot(e);
    if (labelKey !== null) {
      e.preventDefault();
      // A held key would put the label on and take it off again.
      if (!e.repeat) labelByKey(labelKey);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyF") {
      e.preventDefault();
      setFilterSheetOpen(true);
      window.setTimeout(() => searchRef.current?.focus(), 50);
      return;
    }

    const action = resolvePlayerKey(e);
    if (!action) return;
    const nudge = (delta: number) => {
      if (!footage) return;
      playback.seekTo(video.currentTime + delta);
      refollow();
    };
    switch (action) {
      case "next":
        e.preventDefault();
        playback.next("key");
        refollow();
        anchorRef.current = null;
        extendFocusRef.current = null;
        return;
      case "prev":
        e.preventDefault();
        playback.prev("key");
        refollow();
        anchorRef.current = null;
        extendFocusRef.current = null;
        return;
      case "first":
      case "last":
        e.preventDefault();
        playback.toEnd(action);
        refollow();
        anchorRef.current = null;
        extendFocusRef.current = null;
        return;
      case "extend-next":
        e.preventDefault();
        extendTo(1);
        return;
      case "extend-prev":
        e.preventDefault();
        extendTo(-1);
        return;
      case "extend-first":
        e.preventDefault();
        extendTo("first");
        return;
      case "extend-last":
        e.preventDefault();
        extendTo("last");
        return;
      case "select-all":
        if (orderKeys.length > 0) {
          e.preventDefault();
          setSelected(new Set(orderKeys));
          anchorRef.current = orderKeys[0];
          extendFocusRef.current = orderKeys[orderKeys.length - 1];
        }
        return;
      case "toggle-play":
        e.preventDefault();
        if (footage) stageHandle.current?.togglePlay();
        return;
      case "toggle-mute":
        e.preventDefault();
        togglePlayerMuted({ announce: true });
        return;
      case "replay":
        e.preventDefault();
        playback.replay();
        refollow();
        return;
      case "nudge-back":
        e.preventDefault();
        nudge(-NUDGE_SECONDS);
        return;
      case "nudge-forward":
        e.preventDefault();
        nudge(NUDGE_SECONDS);
        return;
      case "nudge-back-far":
        e.preventDefault();
        nudge(-NUDGE_FAR_SECONDS);
        return;
      case "nudge-forward-far":
        e.preventDefault();
        nudge(NUDGE_FAR_SECONDS);
        return;
      case "shuttle-back":
        // WebKit has no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "shuttle-pause":
        e.preventDefault();
        // A swipe still coming to rest would start the video again: it is over now.
        timelineHandle.current?.endScrub();
        video.pause();
        return;
      case "shuttle-forward":
        e.preventDefault();
        setSpeed(nextShuttleRate(speed));
        if (footage && video.paused) video.play().catch(() => {});
        return;
      case "fullscreen":
        e.preventDefault();
        toggleFullscreen();
        return;
      case "escape":
        // Full screen lets go first; then the selection.
        if (playerFs.active) {
          e.preventDefault();
          void playerFs.exit();
        } else if (selected.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        return;
      default:
        return;
    }
  });

  // A sideways swipe over the footage scrubs as one over the timeline does, in full screen too.
  useWheelScrub(stageWrapRef, {
    enabled: footage,
    onScrub: (px) => timelineHandle.current?.scrubBy(px),
    onEnd: () => timelineHandle.current?.endScrub(),
  });

  // ---- The stage's size: as large as the column allows, 16:9 --------------------
  // A game whose sync can be checked has the sync row under its timeline.
  const { ref: stageBoxRef, width: stageWidth } = useStageFit(UNDER_STAGE + (sync.active ? SYNC_PANEL_EXTRA + (sync.parts.length > 0 ? GAME_SYNC_ROW_HEIGHT : 0) : 0));

  // ---- What stands in the way of the footage, and of its timing -----------------
  const fileName = match.videoUrl ? videoBasename(match.videoUrl) : null;
  const stagePanel = !footage ? (
    videoStatus === "none" ? (
      <StagePanel
        title="No video yet"
        body="Add the game’s video to watch the plays. The score and the play-by-play are already here."
        action={<Button size="sm" onClick={() => onOpenDetails()}>Choose video…</Button>}
      />
    ) : videoStatus === "missing" ? (
      <StagePanel
        title={`Can’t find ${fileName ?? "the video"}`}
        body="It may have been moved or renamed, or it’s on another computer. The plays and the score still work."
        action={<Button size="sm" onClick={() => onOpenDetails()}>Locate…</Button>}
      />
    ) : videoStatus === "unreadable" ? (
      <StagePanel
        title={`Can’t read ${fileName ?? "the video"}`}
        body="Scoutable isn’t allowed to read the file. Choose it again to grant access."
        action={<Button size="sm" onClick={() => onOpenDetails()}>Choose video…</Button>}
      />
    ) : (
      <StagePanel
        title="Set the tip-off to line up the plays"
        body="Find the moment the ball goes up, once. Every play, the score graph and this list then follow the video."
        action={<Button size="sm" onClick={() => onOpenDetails()}>Set tip-off</Button>}
      />
    )
  ) : null;

  const looksCut = useMemo(
    () => (footage && match.syncPoint ? videoLooksCut({ durationSeconds: duration, events: match.events, sync: match.syncPoint }).cut : false),
    [footage, match.syncPoint, match.events, duration],
  );
  const banner = !footage ? null : timeline.pastEnd > 0 ? (
    <Callout tone="warning" action={<Button variant="outline" size="sm" onClick={() => onOpenDetails({ openQuarters: true })}>Set quarters</Button>}>
      {looksCut
        ? `This video skips the breaks, so ${timeline.pastEnd} ${timeline.pastEnd === 1 ? "play falls" : "plays fall"} past its end. Set each quarter to line them up.`
        : `${timeline.pastEnd} ${timeline.pastEnd === 1 ? "play falls" : "plays fall"} past the end of the video. The sync may be off.`}
    </Callout>
  ) : sync.jumpsLeft.length > 0 && !sync.active ? (
    <Callout tone="warning" action={<Button variant="outline" size="sm" onClick={sync.startJumps}>Check the jumps</Button>}>
      {jumpWords(sync.jumpsLeft)}
    </Callout>
  ) : timeline.overlaps && !sync.active && sync.progress.left > 0 ? (
    <Callout tone="warning" action={<Button variant="outline" size="sm" onClick={() => sync.startCheck("banner")}>Check sync</Button>}>
      Two quarters overlap in the video, so some plays are in the wrong place.
    </Callout>
  ) : timeline.beforeStart > 0 ? (
    <Callout>
      {match.syncPoint?.footageStart !== undefined ? "The start of the game isn’t in the video" : "The recording starts after tip-off"}: the first{" "}
      {timeline.beforeStart} {timeline.beforeStart === 1 ? "play isn’t" : "plays aren’t"} in it.
    </Callout>
  ) : null;

  // ---- The sync on the timeline: its row, its line of what to do, and the way in ------------
  const stripSyncParts = useMemo<StripSyncPart[]>(() => {
    const on = sync.event ? partOf(sync.parts, sync.event) : null;
    return sync.parts.map((part) => ({
      index: part.index,
      period: part.period,
      cutAt: part.cut ? part.cut.syncVideoTime : null,
      cutShift: part.cut && match.syncPoint ? cutShiftSeconds(match.syncPoint, part.cut) : null,
      name: part.name,
      state: on === part ? "current" : partChecked(part) ? "checked" : "open",
      checks: part.checks.flatMap((c) => {
        const play = playByEvent.get(c.eventId);
        return play ? [play.time] : [];
      }),
    }));
  }, [sync.parts, sync.event, playByEvent, match.syncPoint]);
  const quietLink = "shrink-0 rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection";
  // Under the sync's panel, beside what to do: the clip again, or another play.
  const syncLinks =
    sync.mode.kind === "ask" ? (
      <>
        <button type="button" className={quietLink} onClick={sync.actions.replay}>
          Replay
        </button>
        {sync.mode.purpose !== "narrow" && (
          <button type="button" className={quietLink} onClick={sync.actions.another}>
            Try another play
          </button>
        )}
      </>
    ) : null;
  const syncControl = !footage || sync.parts.length === 0 || sync.active ? null : (
    <>
      <SyncFixesMenu fixes={sync.fixes} playOf={(id) => playByEvent.get(id)?.event} onRemove={(fix) => void sync.removeFix(fix)} disabled={sync.busy} />
      {sync.progress.left === 0 ? (
        <span data-sync="status" className="flex h-6 items-center gap-1 px-1.5 text-callout text-muted-foreground">
          <Check className="size-3.5 text-success" aria-hidden />
          Sync checked
        </span>
      ) : (
        <button
          type="button"
          data-sync="status"
          className={cn(quietControl, "h-6 px-1.5 text-callout text-foreground")}
          onClick={() => sync.startCheck("button")}
          title="Look at one play in each part of the game: a quarter, or the stretch of one between two fixes. Nothing moves unless a play is off."
        >
          <span className="size-2 rounded-full border border-dashed border-muted-foreground" aria-hidden />
          {/* Once some of the game is checked, what is left is named: a count alone said nothing of what a part is. */}
          {sync.progress.checked === 0
            ? "Check sync"
            : sync.progress.left === 1
              ? `Check sync · ${sync.parts.find((p) => !partChecked(p))?.name ?? "1 part left"}`
              : `Check sync · ${sync.progress.left} parts left`}
        </button>
      )}
    </>
  );

  // ---- The Now bar's words ---------------------------------------------------------
  const currentScore = current ? scoreAfter(flow, current.event.eventId) : null;
  const momentPeriod = playback.moment?.period ?? null;
  // A break stands at the score its period ended on; a period that has only just started, at the one before it.
  const breakTotals =
    momentPeriod === null
      ? undefined
      : playback.moment?.phase === "live"
        ? flow.periods.filter((p) => p.period < momentPeriod).at(-1)
        : flow.periods.find((p) => p.period === momentPeriod);
  const skip =
    playback.moment?.phase === "before"
      ? () => seekTo(Math.max(0, (firstBandStart ?? 0) - PERIOD_LEAD_SECONDS), "now_bar", "period", true)
      : playback.moment?.phase === "break" && playback.moment.next !== null
        ? () => toPeriod(playback.moment!.next!, "now_bar")
        : null;
  const breakScore = breakTotals ? { home: breakTotals.homeTotal, away: breakTotals.awayTotal } : null;
  // What the full-screen controls say, where the Now bar is out of sight: the Now bar's own words. Between plays
  // (before tip-off, a break, a quarter's start) that is where the video is; else the play's quarter, clock and score.
  const nowBetween = betweenPlays({ play: current, footage, moment: playback.moment, breakScore });
  const readout = nowBetween
    ? nowBetween.text
    : current
      ? [periodLabel(current.event.period), current.event.gameClockTime && formatGameClock(current.event.gameClockTime), currentScore ? `${currentScore.home}–${currentScore.away}` : null]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return (
    <Page>
      <Toolbar
        variant="static"
        compactBelow="auto"
        title={<GameTitle title={match.title} />}
        back={GAMES_FALLBACK}
        leading={viewSwitch}
        actions={<CollectControl collect={collect} highlight={!tipSeen} />}
      />
      <ResizablePanelGroup direction="horizontal" autoSaveId="game-view" className="min-h-0 flex-1">
        {/* The list on the left and the play on the right, as in Teams' Plays, Add clips and the editor. The ids keep each panel's saved size. */}
        <ResizablePanel id="plays" defaultSize="34" minSize="26" maxSize="48">
          {/* While a play is checked or found the list stands back: a click in it would take the video away from the play. */}
          <div className="relative h-full min-h-0">
          {sync.active && (
            <div data-sync="list-paused" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
              <span className="rounded-full bg-material-popover px-3 py-1.5 text-callout text-foreground shadow-menu ring-1 ring-separator backdrop-blur-xl">
                Paused while you check the sync
              </span>
            </div>
          )}
          <div className={cn("flex h-full min-h-0 flex-col transition-opacity duration-200", sync.active && "pointer-events-none opacity-40")} inert={sync.active}>
            <GameFilterBar
              filters={filters}
              onChange={setFilters}
              teams={teams}
              momentCounts={momentCounts}
              timeouts={marks && marks.timeouts.length > 0 ? "ready" : readingMarks ? "reading" : "none"}
              periods={timeline.bands.map((b) => b.period)}
              players={playerGroups}
              labels={labels.labels}
              visible={order.length}
              total={timeline.byTime.length}
              filtered={filtered}
              addable={addable}
              targetName={collect.target?.name ?? null}
              onAddAll={addAll}
              searchRef={searchRef}
              sheetOpen={filterSheetOpen}
              onSheetOpenChange={setFilterSheetOpen}
              presetsMenu={activeOrgId ? (
                <FilterPresetsMenu
                  presets={presets.presets}
                  current={filters.play}
                  onApply={applyPreset}
                  onSave={(name) => presets.save(name, filters.play)}
                  onRename={presets.rename}
                  onDelete={presets.remove}
                />
              ) : undefined}
            />
            <GamePlayList
              rows={rows}
              hasPlays={timeline.plays.length > 0}
              activeKey={playback.activeKey}
              selected={selected}
              playing={footage}
              showTeam={filters.team === 0}
              flow={flow}
              teams={teams}
              labels={labels.labels}
              assignments={labels.assignments}
              statusOf={collect.statusOf}
              targetName={collect.target?.name ?? null}
              labelPickerFor={labelPickerFor}
              renderLabelPicker={renderRowLabelPicker}
              followSignal={followSignal}
              reveal={reveal}
              restoreScroll={remembered?.list ?? null}
              onLeave={(list) => rememberGameView(match.id, { list })}
              onPress={onPress}
              onAdd={addOne}
              onRemove={collect.removeAdded}
              onLabel={openRowLabels}
              onMarker={onMarker}
              onClearFilters={() => setFilters(EMPTY_GAME_FILTERS)}
              // Finder's rule: an action on a selected item acts on the whole selection.
              rowMenu={(play, anchor) => (
                <GamePlayMenuContent
                  plays={selected.has(play.key) ? selectedPlays : [play]}
                  collect={collect}
                  moment={filters.play.moment}
                  anchor={anchor}
                  onDone={selected.has(play.key) ? clearSelection : undefined}
                  onFixSync={footage && play.reach === "in" && !selected.has(play.key) ? () => sync.fixPlay(play.event, "menu") : undefined}
                  onPutBack={
                    play.own && !selected.has(play.key)
                      ? () => void sync.removeFix({ kind: "own", period: play.event.period, realWorldTime: play.event.realWorldTime, eventId: play.event.eventId })
                      : undefined
                  }
                  goTo={selected.has(play.key) ? undefined : goToTeamOf(play.event)}
                />
              )}
              selecting={selected.size > 0}
              selectionBar={
                <PlaysSelectionBar count={selected.size} collect={collect} plays={() => selectedPlays} moment={filters.play.moment} onClear={clearSelection} />
              }
            />
          </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="player" defaultSize="66" minSize="45">
          <div className="flex h-full min-h-0 flex-col px-4 pt-4">
            <div ref={stageBoxRef} className="flex min-h-0 flex-1 flex-col items-center">
              {/* While the sync is checked or fixed the column is one object with a frame round it: a mode, not playback. */}
              <div
                data-sync-frame={sync.active ? "on" : undefined}
                className={cn(
                  "@container/player flex flex-col rounded-[14px] outline-2 outline-offset-[6px] transition-[outline-color] duration-300",
                  sync.active ? "outline-primary/45" : "outline-transparent",
                )}
                style={{ width: stageWidth || "100%", outlineStyle: "solid" }}
              >
                {sync.active && !playerFs.active && <GameSyncBar sync={sync} links={syncLinks} />}
                <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
                  <div ref={stageWrapRef} className={playerFs.active ? "relative min-h-0 flex-1" : "relative w-full"}>
                    <PlayerStage
                      handleRef={stageHandle}
                      video={video}
                      src={src}
                      fileMissing={!footage}
                      fullscreen={playerFs.active}
                      onToggleFullscreen={toggleFullscreen}
                      onExitFullscreen={() => void playerFs.exit()}
                      title={match.title}
                      // In a window the Now bar under the footage says where the game is; in full screen the stage has to.
                      readout={playerFs.active ? readout : undefined}
                      // The player's own scrubber, as every player in the app has: the whole file on a straight scale.
                      // While a play is checked, the scrubber is that play's clip, with the moment the sync has it at marked.
                      clipWindow={sync.clip ? { start: sync.clip.start, end: sync.clip.end } : duration !== null ? { start: 0, end: duration } : null}
                      scrubLabel={sync.clip ? "Position in the clip" : "Position in the video"}
                      longTimes={!sync.clip}
                      ticks={sync.clip ? [sync.clip.mark] : timeline.bands.map((b) => b.start)}
                      // A drag seeks once a frame; it is reported once, when it is let go.
                      onSeek={(t) => {
                        playback.seekTo(t);
                        refollow();
                      }}
                      onSeekEnd={() => trackSeek("scrubber", "time", null)}
                      transport={{
                        canPrev: playback.canPrev,
                        canNext: playback.canNext,
                        isQueueActive: playback.started,
                        onPrev: () => {
                          playback.prev("transport");
                          refollow();
                        },
                        onNext: () => {
                          playback.next("transport");
                          refollow();
                        },
                        onReplay: () => {
                          playback.replay();
                          refollow();
                        },
                        onStop: () => video.pause(),
                        onPlayAll: () => void video.play().catch(() => {}),
                        labels: { prev: "Previous play", next: "Next play", replay: "Replay play" },
                        hideStop: true,
                      }}
                      speed={speed}
                      onSpeedChange={setSpeed}
                    >
                      {stagePanel}
                      {sync.mode.kind === "ask" && sync.cue && <SyncCue video={video} at={sync.mode.at} cue={sync.cue} label={eventLabel(sync.mode.event)} />}
                      {footage && !playback.started && !sync.active && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void video.play().catch(() => {});
                            }}
                            className="dark flex items-center gap-2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white shadow-menu ring-1 ring-white/15 backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-black/70 active:scale-[0.97]"
                          >
                            <Play className="size-4 fill-current" />
                            {resumeAt.current !== null && startEventId === null ? "Resume" : "Play"}
                          </button>
                        </div>
                      )}
                    </PlayerStage>
                    {/* In the stage's own box, so it is there in full screen too. */}
                    {labelKeysShown && <GameLabelKeys labels={labels.labels} on={current ? labels.assignments.get(current.key) : undefined} />}
                  </div>
                </div>
                {!sync.active && (
                <GameNowBar
                  play={current}
                  footage={footage}
                  moment={playback.moment}
                  score={currentScore}
                  breakScore={breakScore}
                  details={current ? playDetails(current, flow) : []}
                  labels={current ? [...(labels.assignments.get(current.key) ?? [])].flatMap((id) => labels.labels.filter((l) => l.id === id)) : []}
                  collect={current ? collect.statusOf(current.key) : "none"}
                  targetName={collect.target?.name ?? null}
                  labelButton={(trigger) => {
                    const target = nowLabelFor ?? current;
                    return target ? labelPicker(target, trigger, nowLabelFor !== null, (open) => setNowLabelFor(open ? current : null), "top") : trigger;
                  }}
                  lastLabel={lastLabel}
                  onLabelAgain={labelAgain}
                  addRef={addButtonRef}
                  onAdd={addCurrent}
                  onSkip={skip}
                  onFixSync={footage && current && current.reach === "in" ? () => sync.fixPlay(current.event, "now_bar") : undefined}
                />
                )}
                {/* The game's timeline belongs to the player: right under it, as wide as the footage. While a play is
                    being found, a close-up of the video around it takes its place. */}
                {sync.mode.kind === "find" || sync.mode.kind === "confirm" ? (
                  <SyncFindStrip
                    video={video}
                    event={sync.mode.event}
                    mapped={sync.mode.mapped}
                    frozen={sync.mode.kind === "confirm" ? sync.mode.found : null}
                    plays={timeline.plays}
                    flow={flow}
                    duration={duration}
                    onSeek={(t) => {
                      playback.seekTo(t);
                      refollow();
                    }}
                    hint={null}
                  />
                ) : (
                <GameTimelineStrip
                  timeline={timeline}
                  flow={flow}
                  marks={marks}
                  moments={moments}
                  teams={stripTeams}
                  video={footage ? video : null}
                  order={order}
                  filtered={filtered}
                  inTarget={collect.inTarget}
                  activeKey={playback.nowKey}
                  stints={stints}
                  stintName={chosenPlayer?.name ?? null}
                  zoomPeriod={zoomPeriod}
                  onZoom={setZoomPeriod}
                  onPlay={(play) => {
                    dismissTip();
                    playPlay(play, "timeline");
                  }}
                  onSeek={(t) => {
                    dismissTip();
                    playback.seekTo(t);
                    refollow();
                  }}
                  onLandmark={(landmark) => {
                    dismissTip();
                    toLandmark(landmark);
                  }}
                  landmarkTime={landmarkTime}
                  onScrubEnd={(via) => trackSeek(via, "time", null)}
                  handleRef={timelineHandle}
                  hint={sync.active || tipSeen || timeline.plays.length === 0 ? null : "Drag the timeline to move through the game. Double-click a quarter to zoom in."}
                  // The sync row is for checking and fixing: it is there while that goes on, and out of the way otherwise.
                  syncParts={sync.active ? stripSyncParts : undefined}
                  onCheckPart={sync.mode.kind === "ask" && sync.mode.purpose === "check" ? (index) => sync.startCheck("lane", index) : undefined}
                  syncControl={syncControl}
                />
                )}
              </div>
            </div>
            {/* A warning about the sync opens its own room at the foot of the column: the footage gives way, it doesn't jump. */}
            <AutoHeight className="shrink-0">{banner && <div className="pb-3">{banner}</div>}</AutoHeight>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Page>
  );
}
