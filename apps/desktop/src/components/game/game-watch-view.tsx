import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ListPlus, Play, Plus, Tag, VideoOff } from "lucide-react";
import { formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { GAME_MOMENTS, gameFlow, gameMoments, onCourtStints, scoreAfter, type GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_GAME_FILTERS, gameFiltersActive, gameRows, keepPlay, type GameFilters, type GameRow } from "@scoutable/shared/lib/game-list";
import { buildGameTimeline, PERIOD_LEAD_SECONDS, visibleOrder, type TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { videoLooksCut } from "@scoutable/shared/lib/period-sync";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { labelForKey, labelKeySlot } from "@scoutable/shared/lib/label-keys";
import { clickSelection, extendSelection, moveFocus, pruneSelection, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { defaultPreRoll } from "@scoutable/shared/lib/provider";
import { AddToPopover } from "@/components/editor/add-to-popover";
import { PlayerStage, type PlayerStageHandle } from "@/components/editor/player-stage";
import { PILL_LABEL, PillButton, SelectionBar } from "@/components/editor/selection-bar";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { Page } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { togglePlayerMuted } from "@/lib/player-sound";
import { getGameTimelineTipSeen, setGameTimelineTipSeen } from "@/lib/prefs";
import { LABEL_KEY_TOAST, labelKeyMessage, toastNoLabelOnKey, useOptionHeld } from "@/lib/label-keys";
import { rememberLabelUsed, useRecentLabelIds } from "@/lib/recent-labels";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { useClipLabels } from "@/lib/use-clip-labels";
import { useGameMarks } from "@/lib/use-game-marks";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { cn } from "@/lib/utils";
import { videoBasename, type VideoFileStatus } from "@/lib/video-probe";
import type { StoredMatch } from "@/types/match";
import { CollectControl } from "./collect-control";
import { GameFilterBar, type GamePerson } from "./game-filters";
import { GameLabelKeys } from "./game-label-keys";
import { GameNowBar } from "./game-now-bar";
import { GamePlayList } from "./game-play-list";
import { GamePlayMenuContent } from "./game-play-menu";
import { GameTimelineStrip } from "./game-timeline-strip";
import { useCollect } from "./use-collect";
import { useGamePlayback } from "./use-game-playback";

/** The players' remembered speed, shared with the playlist watch view. */
const SPEED_KEY = "scoutable_watch_speed";
/** Under the stage: the Now bar and the gap above it. */
const NOW_BAR_HEIGHT = 52;
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

const positionKey = (matchId: string) => `scoutable_game_position:${matchId}`;

function readPosition(matchId: string): number | null {
  try {
    const v = Number(sessionStorage.getItem(positionKey(matchId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
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
 * The game page's Game view: the whole game on one page. The footage with
 * the Now bar under it, the plays beside it in a list that follows playback,
 * and under both the timeline, which is the scrubber and the overview at
 * once (docs/game-view.md). From here a coach collects plays into a playlist
 * and labels them without leaving the game.
 *
 * Everything but the footage works without footage: a game whose video
 * isn't on this computer, or isn't synced yet, still shows its score graph,
 * its plays and its moments, and its plays can still be collected and
 * labelled.
 */
export function GameWatchView({
  match,
  videoStatus,
  viewSwitch,
  entry,
  startEventId,
  onOpenDetails,
}: {
  match: StoredMatch;
  /** "ok": the video plays here. "missing" / "unreadable": a local file that doesn't. "none": no video linked. */
  videoStatus: VideoFileStatus | "none";
  viewSwitch: ReactNode;
  /** How the coach got here, for analytics. */
  entry: string;
  /** A play to open on (a link from elsewhere). */
  startEventId: number | null;
  onOpenDetails: (opts?: { openQuarters?: boolean }) => void;
}) {
  const navigate = useNavigate();
  const { user, activeOrgId, activeOrgIsPersonal } = useAuth();
  const video = usePersistentVideo();
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const playerFs = usePlayerFullscreen();
  const [speed, setSpeedState] = useState(readSpeed);
  const [duration, setDuration] = useState<number | null>(null);
  const [filters, setFilters] = useState<GameFilters>(EMPTY_GAME_FILTERS);
  const [zoomPeriod, setZoomPeriod] = useState<number | null>(null);
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
      byId.set(e.player.playerId, { id: e.player.playerId, name, number: e.player.pno ? String(e.player.pno) : null, side: e.player.teamNumber === 2 ? 2 : 1 });
    }
    return [...byId.values()].sort((a, b) => a.side - b.side || (Number(a.number) || 999) - (Number(b.number) || 999));
  }, [match.events]);

  const momentCounts = useMemo(() => {
    const counts = Object.fromEntries(GAME_MOMENTS.map((m) => [m, 0])) as Record<GameMoment, number>;
    for (const set of moments.values()) for (const m of set) counts[m]++;
    return counts;
  }, [moments]);

  // ---- Labels, the playlist, the filters ------------------------------------
  const labels = useClipLabels(activeOrgId, match.id, "game_view");
  const collect = useCollect({ match, orgId: activeOrgId, includeUnscoped: activeOrgIsPersonal });

  // One player chosen: their stints on the floor, for the strip and the "while on the floor" switch.
  const chosenPlayer = filters.clip.players.size === 1 ? (people.find((p) => p.name === [...filters.clip.players][0]) ?? null) : null;
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
      playback.seekTo(t, { play });
      refollow();
    },
    [playback, trackSeek, refollow],
  );

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

  // Where the game opens, once, paused: the play a link named, else where this
  // visit's last look left it, else just before tip-off.
  const resumeAt = useRef(readPosition(match.id));
  const placed = useRef(false);
  const firstBandStart = timeline.bands[0]?.start ?? null;
  useEffect(() => {
    if (!footage || placed.current || duration === null) return;
    placed.current = true;
    const linked = startEventId !== null ? playByEvent.get(startEventId) : undefined;
    const at = linked ? linked.start : (resumeAt.current ?? (firstBandStart !== null ? Math.max(0, firstBandStart - TIPOFF_LEAD_SECONDS) : 0));
    video.currentTime = Math.min(at, Math.max(0, duration - 1));
  }, [footage, duration, startEventId, playByEvent, firstBandStart, video]);

  // Remember where the coach was, for coming back from Details or the editor.
  // Kept as playback goes: by the time this view is torn down the video has
  // already given its decoder back and no longer knows where it was.
  useEffect(() => {
    if (!footage) return;
    let last = 0;
    let written = 0;
    const save = () => {
      try {
        if (last > 0) sessionStorage.setItem(positionKey(match.id), String(last));
      } catch {
        // The game opens at tip-off next time.
      }
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
        moment: filters.moment,
        groups: [
          filters.clip.types.size > 0 && "types",
          filters.clip.shotTypes.size > 0 && "shots",
          filters.clip.situations.size > 0 && "situations",
          filters.clip.players.size > 0 && "players",
          (filters.clip.labels?.size ?? 0) > 0 && "labels",
          filters.periods.size > 0 && "quarters",
        ].filter(Boolean),
        search: filters.search.trim() !== "",
        on_court: filters.onCourt,
        visible: order.length,
      });
    }, 800);
    return () => window.clearTimeout(timer);
    // The count rides along; it isn't what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // ---- Moving through the game ----------------------------------------------
  /** The places Page Up and Page Down stop at: each period's start, each timeout's restart, each run's first basket. */
  const jumps = useMemo(() => {
    const list: { time: number; kind: string; period: number; row: string }[] = [];
    for (const b of timeline.bands) list.push({ time: Math.max(0, b.start - PERIOD_LEAD_SECONDS), kind: "period", period: b.period, row: `period:${b.period}` });
    for (const t of marks?.timeouts ?? []) {
      const at = timeline.timeOf(t.resumeRealWorldTime ?? t.realWorldTime, t.period);
      if (at !== null) list.push({ time: Math.max(0, at - 3), kind: "timeout", period: t.period, row: `timeout:${t.eventId}` });
    }
    for (const run of flow.runs) {
      const first = playByEvent.get(run.fromEventId);
      if (first) list.push({ time: first.start, kind: "run", period: run.period, row: `run:${run.fromEventId}` });
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
      playback.seekTo(target.time, { play: !video.paused });
      refollow();
      revealRow(target.row);
    },
    [footage, video, jumps, playback, trackSeek, refollow, revealRow],
  );

  const toPeriod = useCallback(
    (period: number, via: string) => {
      const band = timeline.bands.find((b) => b.period === period);
      if (!band || !footage) return;
      trackSeek(via, "period", period);
      playback.seekTo(Math.max(0, band.start - PERIOD_LEAD_SECONDS), { play: true });
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
        const at = timeline.timeOf(row.timeout.resumeRealWorldTime ?? row.timeout.realWorldTime, row.timeout.period);
        if (at !== null) seekTo(Math.max(0, at - 3), "marker", "timeout", true);
        return;
      }
      const band = timeline.bands.find((b) => b.period === row.period);
      if (band) seekTo(Math.max(band.start, band.end - 10), "marker", "period", true);
    },
    [footage, timeline, playByEvent, playPlay, seekTo],
  );

  // Zoomed into a quarter, the strip turns the page when playback does.
  const livePeriod = playback.moment?.phase === "live" ? playback.moment.period : null;
  useEffect(() => {
    if (zoomPeriod !== null && livePeriod !== null && livePeriod !== zoomPeriod) setZoomPeriod(livePeriod);
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
    if (current && collect.statusOf(current.key) === "none") collect.add([current], "now_bar", filters.moment, addButtonRef.current);
  }, [current, collect, filters.moment]);
  const addAll = useCallback(
    (anchor: HTMLElement) => {
      const plays = order.map((i) => timeline.plays[i]).filter((p) => collect.statusOf(p.key) === "none");
      collect.add(plays, "bulk", filters.moment, anchor);
    },
    [order, timeline, collect, filters.moment],
  );
  const addOne = useCallback((play: TimedPlay, anchor: HTMLElement) => collect.add([play], "row", filters.moment, anchor), [collect, filters.moment]);
  const openRowLabels = useCallback((play: TimedPlay) => setLabelPickerFor(play.key), []);

  // The label used last, of this space's vocabulary: what "the same label again" puts on.
  const recentLabelIds = useRecentLabelIds();
  const lastLabel = useMemo(() => {
    const byId = new Map(labels.labels.map((l) => [l.id, l]));
    for (const id of recentLabelIds) {
      const label = byId.get(id);
      if (label) return label;
    }
    return null;
  }, [recentLabelIds, labels.labels]);

  /**
   * The same label again, on the play on screen, without the picker: one key (or one click) per play for
   * a coach who is looking for one thing through the whole game. It only ever puts the label on; with no
   * label used yet it opens the picker.
   */
  const labelAgain = useCallback(() => {
    if (!current) return;
    if (!lastLabel) {
      setNowLabelFor(current);
      return;
    }
    if (labels.assignments.get(current.key)?.has(lastLabel.id)) return;
    const { eventId } = current.event;
    void labels.handlers.onToggleClip(match.id, eventId, lastLabel.id, "none");
    rememberLabelUsed(lastLabel.id);
    trackEvent("label_picked", { by: "repeat", position: 0, recent: true, searched: false, created: false });
    toast(labelKeyMessage(lastLabel.name, true), {
      id: LABEL_KEY_TOAST,
      action: { label: "Undo", onClick: () => void labels.handlers.onToggleClip(match.id, eventId, lastLabel.id, "all") },
    });
  }, [current, lastLabel, labels.assignments, labels.handlers, match.id]);

  /**
   * A label's own key (⌥1–⌥9): the label goes on the play on screen, or comes off it, while the footage
   * plays on. Undo names the play the key was pressed on: by then another one may be on screen.
   */
  const labelByKey = useCallback(
    (slot: number) => {
      const label = labelForKey(labels.labels, slot);
      if (!label) {
        toastNoLabelOnKey(slot);
        return;
      }
      if (!current) return;
      const { eventId } = current.event;
      const on = !(labels.assignments.get(current.key)?.has(label.id) ?? false);
      void labels.handlers.onToggleClip(match.id, eventId, label.id, on ? "none" : "all");
      if (on) {
        rememberLabelUsed(label.id);
        trackEvent("label_picked", { by: "hotkey", position: slot, recent: false, searched: false, created: false });
      }
      toast(labelKeyMessage(label.name, on), {
        id: LABEL_KEY_TOAST,
        action: { label: "Undo", onClick: () => void labels.handlers.onToggleClip(match.id, eventId, label.id, on ? "all" : "none") },
      });
    },
    [current, labels.labels, labels.assignments, labels.handlers, match.id],
  );
  // Option held for a moment asks which key is which label.
  const labelKeysShown = useOptionHeld("game");

  // Choosing a label holds the footage: the label goes on the play it was asked for, and nothing
  // goes by unseen meanwhile. It carries on by itself when the picker closes.
  const labelling = nowLabelFor !== null || labelPickerFor !== null;
  const resumeAfterLabel = useRef(false);
  useEffect(() => {
    if (!footage) return;
    if (labelling) {
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

  // ---- The stage's size: as large as the column allows, 16:9 --------------------
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  useLayoutEffect(() => {
    const el = stageBoxRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight - NOW_BAR_HEIGHT;
      setStageWidth(Math.max(240, Math.floor(Math.min(w, (h * 16) / 9))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  ) : timeline.overlaps ? (
    <Callout tone="warning" action={<Button variant="outline" size="sm" onClick={() => onOpenDetails({ openQuarters: true })}>Check the sync</Button>}>
      Two quarters overlap in the video, so some plays are in the wrong place. One quarter’s sync is off.
    </Callout>
  ) : timeline.beforeStart > 0 ? (
    <Callout>
      The recording starts after tip-off: the first {timeline.beforeStart} {timeline.beforeStart === 1 ? "play isn’t" : "plays aren’t"} in it.
    </Callout>
  ) : null;

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
  const readout = current
    ? [periodLabel(current.event.period), current.event.gameClockTime && formatGameClock(current.event.gameClockTime), currentScore ? `${currentScore.home}–${currentScore.away}` : null]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <Page>
      <Toolbar
        variant="static"
        title={match.title}
        leading={
          <>
            <Button variant="ghost" size="sm" className="-ml-1 shrink-0 text-muted-foreground" onClick={() => navigate("/matches")}>
              <ChevronLeft />
              Library
            </Button>
            {viewSwitch}
          </>
        }
        actions={<CollectControl collect={collect} highlight={!tipSeen} />}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ResizablePanelGroup direction="horizontal" autoSaveId="game-view" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="66" minSize="45">
            <div className="flex h-full min-h-0 flex-col px-4 pt-4">
              <div ref={stageBoxRef} className="flex min-h-0 flex-1 flex-col items-center">
                <div className="flex flex-col" style={{ width: stageWidth || "100%" }}>
                  <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
                    <div className={playerFs.active ? "relative min-h-0 flex-1" : "relative w-full"}>
                      <PlayerStage
                        handleRef={stageHandle}
                        video={video}
                        src={src}
                        fileMissing={!footage}
                        fullscreen={playerFs.active}
                        onToggleFullscreen={toggleFullscreen}
                        onExitFullscreen={() => void playerFs.exit()}
                        title={match.title}
                        readout={readout}
                        // Windowed, the timeline below is the scrubber; in full screen the stage carries its own.
                        clipWindow={playerFs.active && duration !== null ? { start: 0, end: duration } : null}
                        longTimes
                        ticks={timeline.bands.map((b) => b.start)}
                        onSeek={(t) => seekTo(t, "transport")}
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
                        {footage && !playback.started && (
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
                  <GameNowBar
                    play={current}
                    footage={footage}
                    moment={playback.moment}
                    score={currentScore}
                    breakScore={breakTotals ? { home: breakTotals.homeTotal, away: breakTotals.awayTotal } : null}
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
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="34" minSize="26" maxSize="48">
            <div className="flex h-full min-h-0 flex-col">
              <GameFilterBar
                filters={filters}
                onChange={setFilters}
                teams={teams}
                momentCounts={momentCounts}
                timeouts={marks && marks.timeouts.length > 0 ? "ready" : readingMarks ? "reading" : "none"}
                periods={timeline.bands.map((b) => b.period)}
                people={people}
                labels={labels.labels}
                visible={order.length}
                filtered={filtered}
                addable={addable}
                targetName={collect.target?.name ?? null}
                onAddAll={addAll}
                searchRef={searchRef}
                sheetOpen={filterSheetOpen}
                onSheetOpenChange={setFilterSheetOpen}
              />
              <GamePlayList
                rows={rows}
                hasPlays={timeline.plays.length > 0}
                activeKey={playback.activeKey}
                selected={selected}
                playing={footage}
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
                    moment={filters.moment}
                    anchor={anchor}
                    onDone={selected.has(play.key) ? clearSelection : undefined}
                  />
                )}
                selecting={selected.size > 0}
                selectionBar={
                  <SelectionBar
                    count={selected.size}
                    onClear={clearSelection}
                    clearTitle="Deselect all (Esc)"
                    group={null}
                    addTo={
                      <>
                        <PillButton
                          title={collect.target ? `Add ${selected.size} ${selected.size === 1 ? "play" : "plays"} to ${collect.target.name}` : "Add to playlist…"}
                          // With no target the picker opens from its own button (the pill leaves with the selection), and
                          // the selection stays until a playlist is chosen and the plays are in: dismissed, nothing is lost.
                          onClick={() => collect.add(selectedPlays, "selection", filters.moment, null, clearSelection)}
                        >
                          <Plus />
                          {collect.target ? (
                            <span className={cn(PILL_LABEL, "max-w-40 truncate")}>Add to {collect.target.name}</span>
                          ) : (
                            <span className={PILL_LABEL}>Add to playlist…</span>
                          )}
                        </PillButton>
                        <AddToPopover
                          playlists={collect.candidates}
                          activePlaylistId={collect.target?.id ?? null}
                          onAddToPlaylist={async (pl) => {
                            collect.addToPlaylist(pl, selectedPlays, "selection", filters.moment);
                            clearSelection();
                          }}
                          onCreatePlaylist={async (name) => {
                            await collect.createAndAddTo(name, selectedPlays, "selection", filters.moment);
                            clearSelection();
                          }}
                          trigger={
                            <PillButton title="Add to another playlist">
                              <ListPlus />
                              <span className={PILL_LABEL}>Another playlist</span>
                              <ChevronDown className="size-3 text-muted-foreground" />
                            </PillButton>
                          }
                        />
                      </>
                    }
                  />
                }
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {/* A warning about the sync opens its own room: the footage above gives way, it doesn't jump. */}
        <AutoHeight className="shrink-0">{banner && <div className="px-4 pb-2">{banner}</div>}</AutoHeight>
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
          hint={tipSeen || timeline.plays.length === 0 ? null : "Click or drag anywhere on the timeline to move through the game. Double-click a quarter to zoom in."}
        />
      </div>
    </Page>
  );
}
