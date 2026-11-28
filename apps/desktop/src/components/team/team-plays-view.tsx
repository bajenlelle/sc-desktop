import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { gamePath, teamPath } from "@/components/entity-link";
import { Check, Film, Plus } from "lucide-react";
import { toast } from "sonner";
import { playersByTeam } from "@scoutable/shared/lib/clip-filters";
import { activeGroups, EMPTY_PLAY_FILTERS, playFiltersActive, type PlayFilters } from "@scoutable/shared/lib/play-filters";
import { applyPresetFilters, presetLabelsGone, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { pickLabel } from "@scoutable/shared/lib/team-copy";
import { pickKeys, sideNumber, sideOf, teamPlayRows, type PlaysPick, type PlaysSide, type TeamPlayRow } from "@scoutable/shared/lib/team-video";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { labelKeySlot } from "@scoutable/shared/lib/label-keys";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import type { Collect } from "@/components/game/use-collect";
import { GamePlayMenuContent } from "@/components/game/game-play-menu";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { RowLabelButton } from "@/components/plays/play-row";
import { usePlayLabelKeys } from "@/components/plays/use-play-label-keys";
import { useStageFit } from "@/components/plays/use-stage-fit";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { rememberLabelUsed } from "@/lib/recent-labels";
import { togglePlayerMuted } from "@/lib/player-sound";
import { DEFAULT_POST_ROLL, DEFAULT_PRE_ROLL } from "@/lib/ship-clips";
import { TEAM_UNDER_STAGE, TeamPlaysStage } from "./team-plays-stage";
import { useCrossGamePlayback } from "./use-cross-game-playback";
import type { Label } from "@scoutable/shared/types/labels";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useFilterPresets } from "@/lib/use-filter-presets";
import type { TeamPlays } from "@/lib/use-team-plays";
import { TeamPlayList, type ListRow, type RowClick } from "./team-play-list";
import { TeamPlaysFilters } from "./team-plays-filters";
import { PlaysCountLine } from "@/components/plays/plays-count-line";
import { PlaysSelectionActions } from "@/components/plays/plays-selection-bar";
import { clickSelection, extendSelection, moveFocus, pruneSelection, selectAll, selectAllState, toggleKey, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { usePlayMoments } from "@/components/plays/use-play-moments";
import { trackEvent } from "@/lib/analytics";
import { useRecalled, useRememberPage } from "@/lib/page-memory";

/** What Plays keeps of how it was left, per history entry (lib/page-memory.ts). */
interface PlaysKept {
  filters: PlayFilters;
  unticked: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  current: string | null;
}
const PLAYS_KEPT = "team-plays";

/** No labels: one set, so the stage's memo of the play shown holds. */
const EMPTY_LABELS: ReadonlySet<string> = new Set();

/** The team's latest played game that can be imported: the empty view's one action. */
export interface LatestImport {
  label: string;
  /** The import page's state for that game; null opens the import page as from the sidebar. */
  state: unknown;
}

/**
 * Plays: the team's plays across the coach's games (docs/teams.md, "Plays"),
 * one list newest game first, filtered as Add clips filters, with what Watch
 * picked as one pill. A click plays a play, and playback runs on into the next
 * game; plays are collected into the target playlist as in the game view.
 */
export function TeamPlaysView({
  orgId,
  plays,
  side,
  onSide,
  pick,
  onClearPick,
  latestImport,
  labels,
  labelsOf,
  labelHandlers,
  collect,
  active,
  competitionId,
}: {
  /** The season the plays are in, for an opponent's name to open their page. */
  competitionId: number | null;
  orgId: string | null;
  plays: TeamPlays;
  side: PlaysSide;
  onSide: (side: PlaysSide) => void;
  pick: PlaysPick | null;
  onClearPick: () => void;
  latestImport: LatestImport | null;
  labels: readonly Label[];
  labelsOf: (key: string) => ReadonlySet<string> | undefined;
  labelHandlers: ClipBrowserLabelHandlers;
  collect: Collect;
  /** Plays is the view shown: it owns the keys, and nothing plays while it is hidden. */
  active: boolean;
}) {
  // Back to these plays (from a game opened here, say) finds them as they were left (lib/page-memory.ts).
  const kept = useRecalled<PlaysKept>(PLAYS_KEPT);
  const [filters, setFiltersState] = useState<PlayFilters>(() => kept?.filters ?? EMPTY_PLAY_FILTERS);
  const setFilters = (change: (f: PlayFilters) => PlayFilters) => setFiltersState(change);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => kept?.unticked ?? new Set());
  const presets = useFilterPresets(orgId, "team_plays");
  const labelIds = useMemo(() => labels.map((l) => l.id), [labels]);
  const applyPreset = (p: FilterPreset) => {
    setFiltersState((f) => applyPresetFilters(f, p.filters, labelIds));
    presets.applied(p);
    if (presetLabelsGone(p.filters, labelIds)) toast("This preset's labels no longer exist, so they weren't applied");
  };

  const allGames = useMemo(() => plays.games.map((g) => g.game), [plays.games]);
  const shown = useMemo(() => plays.games.filter((g) => !unticked.has(g.game.gameId)), [plays.games, unticked]);

  // The picked plays over the games shown, and how many of them went in (threes, a shot zone).
  const picked = useMemo(() => {
    if (!pick) return null;
    const keys = pickKeys(pick, side, shown);
    const set = new Set(keys);
    let made = 0;
    for (const g of shown) for (const e of g.events) if (set.has(`${g.game.gameId}:${e.eventId}`) && e.isSuccessful === 1) made++;
    const counted = pick.kind === "zone" || (pick.kind === "stat" && pick.stat === "threes");
    return { set, label: pickLabel(pick, keys.length, counted ? made : null) };
  }, [pick, side, shown]);

  const playerGroups = useMemo(
    () => playersByTeam(shown.flatMap((g) => g.events.filter((e) => sideOf(e) === sideNumber(g.game, side)))),
    [shown, side],
  );

  // The When section: the quarters the games have, and each game's moments (its marks when the library has them).
  const momentGames = useMemo(
    () => shown.map((g) => ({ gameId: g.game.gameId, events: g.events, gameMarks: plays.matches.get(g.game.gameId)?.gameMarks ?? null })),
    [shown, plays.matches],
  );
  const moments = usePlayMoments(momentGames);
  const periods = useMemo(() => [...new Set(shown.flatMap((g) => g.events.map((e) => e.period)))].sort((a, b) => a - b), [shown]);

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    for (const r of teamPlayRows(shown, side, picked?.set ?? null, filters, labelsOf, moments.momentsOf)) {
      out.push(r);
      if (r.kind === "game") {
        const why = plays.playable(r.game.gameId);
        if (why !== "ok") out.push({ kind: "note", game: r.game, why });
      }
    }
    return out;
  }, [shown, side, picked, filters, labelsOf, plays, moments]);
  const playRows = useMemo(() => rows.filter((r): r is Extract<TeamPlayRow, { kind: "play" }> => r.kind === "play"), [rows]);
  const playCount = playRows.length;
  const gameCount = rows.filter((r) => r.kind === "game").length;

  // ---- Playback ---------------------------------------------------------------
  const stageBox = useStageFit(TEAM_UNDER_STAGE);
  const video = usePersistentVideo();
  const [speed, setSpeedState] = useState(1);
  const setSpeed = (s: number) => {
    setSpeedState(s);
    video.playbackRate = s;
  };
  const playbackRows = useMemo(() => rows.filter((r): r is TeamPlayRow => r.kind !== "note"), [rows]);
  const isOk = useCallback((id: string) => plays.playable(id) === "ok", [plays]);
  const playback = useCrossGamePlayback({
    video,
    rows: playbackRows,
    matches: plays.matches,
    playable: isOk,
    preRoll: DEFAULT_PRE_ROLL,
    postRoll: DEFAULT_POST_ROLL,
  });
  // Hidden (Season shown), nothing plays on.
  if (!active && !video.paused) video.pause();

  // ---- Selection (list-selection.ts, as the game view and Add clips): a plain click plays and keeps the picked
  // plays, ⌘-click or a row's check toggles, Shift-click and Shift+arrows a range, Return the play on screen,
  // ⌘A every listed play the target can still take, Esc lets go ----
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => kept?.selected ?? new Set());
  const anchor = useRef<string | null>(null);
  const extendFocus = useRef<string | null>(null);
  const playKeys = useMemo(() => playRows.map((r) => r.key), [playRows]);
  // A filter that hides selected plays lets go of them: what is picked is always what is listed (and added). Not
  // while the plays are still being read: coming back to the page, the kept selection waits for its rows.
  const playsRead = plays.status === "ready";
  useEffect(() => {
    if (playsRead) setSelected((prev) => pruneSelection(prev, playKeys));
  }, [playKeys, playsRead]);
  /** The listed plays the target has already: select all leaves them out. */
  const blockedKeys = useMemo(() => new Set(playKeys.filter((k) => collect.statusOf(k) !== "none")), [playKeys, collect]);

  // How the plays are left, for the way back; and on the way back, the play that was on the stage, shown again
  // where it starts, paused, once its row is listed.
  const currentKey = playback.currentKey;
  const leftAs = useMemo<PlaysKept>(() => ({ filters, unticked, selected, current: currentKey }), [filters, unticked, selected, currentKey]);
  useRememberPage(PLAYS_KEPT, leftAs);
  const cueOnReturn = useRef(kept?.current ?? null);
  const cue = playback.cue;
  useEffect(() => {
    const key = cueOnReturn.current;
    if (!key || !active || !playRows.some((r) => r.key === key)) return;
    cueOnReturn.current = null;
    cue(key);
  }, [playRows, active, cue]);
  const onRowClick = useCallback(
    (key: string, how: RowClick) => {
      // The click is on the list now: a control that still has the keyboard (the toolbar's Season | Plays, whose
      // arrows move between its options) lets go, so ↑ ↓ walk the plays. The row itself doesn't take focus.
      const held = document.activeElement;
      if (held instanceof HTMLElement && held !== document.body) held.blur();
      const shift = !!how.range;
      const toggle = !shift && !!how.toggle;
      setSelected((prev) => {
        const next = clickSelection({ order: playKeys, selected: prev, anchor: anchor.current, focus: extendFocus.current, key, shift, toggle, keepOnPlain: true });
        anchor.current = next.anchor;
        extendFocus.current = next.focus;
        return next.selected;
      });
      if (!shift && !toggle) playback.play(key);
    },
    [playKeys, playback],
  );
  /** Shift+arrows: select from the anchor to the play there, and play it. */
  const extendTo = (move: FocusMove) => {
    const from = extendFocus.current ?? playback.currentKey;
    const to = moveFocus(playKeys, from, move);
    if (to === null) return;
    const shown = (k: string | null): k is string => k !== null && playKeys.includes(k);
    const from0 = shown(anchor.current) ? anchor.current : shown(from) ? from : to;
    setSelected((prev) => extendSelection({ order: playKeys, selected: prev, anchor: from0, previousFocus: shown(from) ? from : null, focus: to }));
    anchor.current = from0;
    extendFocus.current = to;
    if (to !== playback.currentKey) playback.play(to);
  };

  // ---- Collecting and labels: on the selection when there is one, else on the play shown ----
  // From a row (its Label, +, or menu), Finder's rule: the selection if the row is in it, else that row alone.
  // From the keys and the stage: the selection, else the play on screen.
  const targetsFor = useCallback(
    (key?: string): Extract<TeamPlayRow, { kind: "play" }>[] => {
      if (key !== undefined && !selected.has(key)) {
        const row = playRows.find((r) => r.key === key);
        return row ? [row] : [];
      }
      if (selected.size > 0) return playRows.filter((r) => selected.has(r.key));
      return playback.current ? [playback.current] : [];
    },
    [selected, playRows, playback],
  );
  const targets = useCallback(() => targetsFor(), [targetsFor]);
  const timed = (rs: Extract<TeamPlayRow, { kind: "play" }>[]): TimedPlay[] =>
    rs.map((r) => ({ key: r.key, event: r.event, time: 0, start: 0, reach: "in" }));
  const add = (anchorEl: HTMLElement | null) => {
    const rs = targets();
    if (rs.length === 0) return;
    collect.add(timed(rs), selected.size > 0 ? "selection" : "now_bar", null, anchorEl, () => setSelected(new Set()));
  };
  // A row's own + and ✓, and its menu.
  const addRow = (key: string, anchorEl: HTMLElement) => {
    const inSelection = selected.has(key);
    collect.add(timed(targetsFor(key)), inSelection ? "selection" : "row", null, anchorEl, () => {
      if (inSelection) setSelected(new Set());
    });
  };
  const removeRow = (key: string) => {
    const row = playRows.find((r) => r.key === key);
    if (row) collect.removeAdded(timed([row])[0]);
  };
  // What the rows are handed: made once, calling the latest handlers, so a row's memo holds and a click draws only
  // the rows it changes.
  const latest = useRef({ onRowClick, addRow, removeRow });
  latest.current = { onRowClick, addRow, removeRow };
  const onPlay = useCallback((key: string, how: RowClick) => latest.current.onRowClick(key, how), []);
  const onAdd = useCallback((key: string, anchorEl: HTMLElement) => latest.current.addRow(key, anchorEl), []);
  const onRemove = useCallback((key: string) => latest.current.removeRow(key), []);
  const rowMenu = (key: string, anchorEl: HTMLElement) => (
    <GamePlayMenuContent
      plays={timed(targetsFor(key))}
      collect={collect}
      moment={null}
      anchor={anchorEl}
      onDone={() => {
        if (selected.has(key)) setSelected(new Set());
      }}
      goTo={selected.has(key) && selected.size > 1 ? undefined : goToOf(key)}
    />
  );
  // Where one play leads: its game at the play, and the opponent's page when the play is theirs.
  const navigate = useNavigate();
  const goToOf = (key: string) => {
    const r = playRows.find((x) => x.key === key);
    if (!r) return undefined;
    const g = r.game;
    const out = [{ label: "Show in game", onSelect: () => navigate(gamePath(g.gameId, { play: r.event.eventId })) }];
    const theirs = sideOf(r.event) !== null && sideOf(r.event) !== g.side;
    if (theirs && competitionId && g.opponentId) {
      const team = { competitionId, teamId: g.opponentId };
      out.push({ label: `Go to ${g.opponentName}`, onSelect: () => navigate(teamPath(team), { state: { from: "team" } }) });
    }
    return out;
  };
  // A row's label picker: one row at a time, as the game view's.
  const [labelFor, setLabelFor] = useState<string | null>(null);
  const renderLabelPicker = (key: string) => {
    const rs = targetsFor(key);
    const sets = rs.map((r) => labelsOf(r.key) ?? new Set<string>());
    const all = new Set(labels.filter((l) => sets.length > 0 && sets.every((x) => x.has(l.id))).map((l) => l.id));
    const some = new Set(labels.filter((l) => !all.has(l.id) && sets.some((x) => x.has(l.id))).map((l) => l.id));
    return (
      <LabelPickerPopover
        open
        onOpenChange={(open) => {
          if (!open) setLabelFor(null);
        }}
        trigger={<RowLabelButton visible />}
        labels={[...labels]}
        assignedAllIds={all}
        assignedSomeIds={some}
        onToggle={(labelId, state) => {
          rememberLabelUsed(labelId);
          if (rs.length === 1) return labelHandlers.onToggleClip(rs[0].game.gameId, rs[0].event.eventId, labelId, state);
          return labelHandlers.onBulkToggle(rs.map((r) => ({ matchId: r.game.gameId, eventId: r.event.eventId })), labelId, state);
        }}
        onCreate={labelHandlers.onCreate}
        onRename={labelHandlers.onRename}
        onRecolor={labelHandlers.onRecolor}
        onDelete={labelHandlers.onDelete}
        onSetKey={labelHandlers.onSetKey}
        onSeedDefaults={labelHandlers.onSeedDefaults}
      />
    );
  };
  const [labelOpen, setLabelOpen] = useState(false);
  // The label keys (⌥1–⌥9, ⇧G, Option held), as the game view's: on the selection when there is one, else the play on screen.
  const labelTargets = useCallback(() => targets().map((r) => ({ key: r.key, matchId: r.game.gameId, eventId: r.event.eventId })), [targets]);
  const openStagePicker = useCallback(() => {
    if (playback.current) setLabelOpen(true);
  }, [playback]);
  const labelKeys = usePlayLabelKeys({
    scope: "team-plays",
    labels,
    labelsOf,
    targets: labelTargets,
    handlers: labelHandlers,
    openPicker: openStagePicker,
  });

  // Choosing a label holds the footage, as in the game view: the label goes on the play it was asked for, and
  // nothing goes by unseen meanwhile. It carries on by itself when the picker closes.
  const labelling = labelOpen || labelFor !== null;
  const resumeAfterLabel = useRef(false);
  useEffect(() => {
    if (labelling) {
      if (!video.paused) {
        resumeAfterLabel.current = true;
        video.pause();
      }
    } else if (resumeAfterLabel.current) {
      resumeAfterLabel.current = false;
      video.play().catch(() => {});
    }
  }, [labelling, video]);

  // A filter change is one event once the coach has stopped changing it (the game view's game_view_filtered).
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    const timer = window.setTimeout(() => trackEvent("plays_filtered", { surface: "team_plays", groups: activeGroups(filters), visible: playRows.length }), 800);
    return () => window.clearTimeout(timer);
    // The count rides along; it isn't what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // ---- Keys ---------------------------------------------------------------------
  // The page's keys while Plays is shown, as the game view's are: focus is often on the toolbar's switch, so no container.
  useKeyScope("team-plays", active);
  useHotkeys(
    "team-plays",
    (e) => {
      // A filter menu's type-ahead ("a" for Andersson) keeps its letters: the scope has no container to tell it from the page.
      if (e.target instanceof Element && e.target.closest('[role="menu"],[role="listbox"],[role="dialog"]')) return;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      // ⌘F: the Filter popover with its search, as in the game view.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        setFilterOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      if (plain && !e.shiftKey && e.code === "KeyA") {
        e.preventDefault();
        add(null);
        return;
      }
      if (plain && !e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        if (playback.current) setLabelOpen(true);
        return;
      }
      if (plain && e.shiftKey && e.code === "KeyG") {
        e.preventDefault();
        labelKeys.labelAgain();
        return;
      }
      const slot = labelKeySlot(e);
      if (slot !== null) {
        e.preventDefault();
        // A held key would put the label on and take it off again.
        if (!e.repeat) labelKeys.labelByKey(slot);
        return;
      }
      if (e.code === "Escape" && selected.size > 0) {
        e.preventDefault();
        setSelected(new Set());
        return;
      }
      // Return picks the play on screen, or lets it go.
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && playback.currentKey && !blockedKeys.has(playback.currentKey)) {
        if (e.target instanceof HTMLElement && e.target.closest("button, a, input, textarea")) return;
        e.preventDefault();
        const key = playback.currentKey;
        setSelected((prev) => toggleKey(prev, key));
        anchor.current = key;
        return;
      }
      const action = resolvePlayerKey(e);
      switch (action) {
        case "select-all":
          e.preventDefault();
          setSelected(selectAll(playKeys, blockedKeys));
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
        case "toggle-play":
          e.preventDefault();
          if (!playback.current) playback.playAll();
          else if (video.paused) video.play().catch(() => {});
          else video.pause();
          return;
        case "replay":
          e.preventDefault();
          playback.replay();
          return;
        case "next":
          e.preventDefault();
          if (playback.current) playback.next();
          else playback.playAll();
          return;
        case "prev":
          e.preventDefault();
          playback.previous();
          return;
        case "toggle-mute":
          e.preventDefault();
          togglePlayerMuted({ announce: true });
          return;
        case "nudge-back":
        case "nudge-forward":
        case "nudge-back-far":
        case "nudge-forward-far": {
          e.preventDefault();
          const far = action.endsWith("-far");
          video.currentTime = Math.max(0, video.currentTime + (action.startsWith("nudge-back") ? -1 : 1) * (far ? NUDGE_FAR_SECONDS : NUDGE_SECONDS));
          return;
        }
        case "shuttle-pause":
          e.preventDefault();
          video.pause();
          return;
        case "shuttle-forward":
          e.preventDefault();
          setSpeed(nextShuttleRate(speed));
          if (video.paused) video.play().catch(() => {});
          return;
        case "shuttle-back":
          // WebKit has no reverse playback; stepping back is the honest version.
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          return;
      }
    },
    active,
  );

  const labelsByKey = useMemo(() => {
    const out = new Map<string, Label[]>();
    for (const r of rows) {
      if (r.kind !== "play") continue;
      const ids = labelsOf(r.key);
      if (ids && ids.size > 0) out.set(r.key, labels.filter((l) => ids.has(l.id)));
    }
    return out;
  }, [rows, labels, labelsOf]);

  if (plays.status === "none") {
    return (
      <EmptyState
        icon={<Film />}
        title="None of their games are imported yet."
        body="Import one of their games to watch their plays here."
        action={
          latestImport ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/upload" state={latestImport.state ?? undefined}>
                Import their latest game: {latestImport.label}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const filtered = playFiltersActive(filters);
  // Every filter and the pick from Season: the count line's Clear filters, and the empty state's.
  const clearAll = () => {
    setFiltersState(EMPTY_PLAY_FILTERS);
    onClearPick();
  };
  return (
    <div className="view-fade flex min-h-0 flex-1 flex-col">
      {/* The divider between the list and the player drags, as in the game view: a wider column, a larger player. */}
      <ResizablePanelGroup direction="horizontal" autoSaveId="team-plays" className="min-h-0 flex-1">
        <ResizablePanel id="plays" defaultSize="42" minSize="320px" maxSize="60">
          <section aria-label="Their plays" className="flex h-full min-h-0 flex-col">
            {/* The filters sit over the list they narrow, so the footage starts at the top of its column. */}
            <TeamPlaysFilters
              side={side}
              onSide={onSide}
              games={allGames}
              unticked={unticked}
              onUntick={setUnticked}
              filters={filters}
              setFilters={setFilters}
              playerGroups={playerGroups}
              labels={labels}
              presets={presets}
              onApplyPreset={applyPreset}
              pill={picked?.label ?? null}
              onClearPick={onClearPick}
              periods={periods}
              moments={moments}
              open={filterOpen}
              onOpenChange={setFilterOpen}
              searchRef={searchRef}
            />
            <PlaysCountLine
              className="border-b border-separator px-4"
              count={playCount}
              detail={`in ${gameCount} ${gameCount === 1 ? "game" : "games"}`}
              filtered={filtered || !!pick}
              onClear={clearAll}
              trail={
                <>
                  {/* While filters narrow the list, its plays go in with one press (as the game view's Add all). */}
                  {(filtered || !!pick) && playKeys.length > 0 && (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={blockedKeys.size === playKeys.length}
                      onClick={(e) =>
                        collect.add(timed(playRows.filter((r) => !blockedKeys.has(r.key))), "bulk", null, e.currentTarget)
                      }
                    >
                      {blockedKeys.size === playKeys.length ? <Check /> : <Plus />}
                      {blockedKeys.size === playKeys.length
                        ? "All added"
                        : blockedKeys.size === 0
                          ? `Add all ${playKeys.length}`
                          : `Add the other ${playKeys.length - blockedKeys.size}`}
                    </Button>
                  )}
                  Newest game first
                </>
              }
              selection={{
                state: selectAllState(playKeys, selected, blockedKeys),
                selected: selected.size,
                selectable: playKeys.length - blockedKeys.size,
                onSelectAll: () => setSelected(selectAll(playKeys, blockedKeys)),
                onClear: () => setSelected(new Set()),
                actions: (
                  <PlaysSelectionActions
                    count={selected.size}
                    collect={collect}
                    plays={() => timed(playRows.filter((r) => selected.has(r.key)))}
                    onClear={() => setSelected(new Set())}
                  />
                ),
              }}
            />
            {plays.failed.length > 0 && (
              <div className="flex shrink-0 items-center gap-3 border-b border-separator px-4 py-2">
                <div className="min-w-0 flex-1 text-callout text-muted-foreground">
                  {plays.failed.map((g) => (
                    <p key={g.gameId}>Couldn&apos;t load plays for {g.home ? "vs" : "at"} {g.opponentName}.</p>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={plays.retry}>
                  Try again
                </Button>
              </div>
            )}
            {rows.length > 0 ? (
              <TeamPlayList
                rows={rows}
                competitionId={competitionId}
                current={playback.currentKey}
                selected={selected}
                playable={plays.playable}
                labelsByKey={labelsByKey}
                statusOf={collect.statusOf}
                targetName={collect.target?.name ?? null}
                labelPickerFor={labelFor}
                renderLabelPicker={renderLabelPicker}
                rowMenu={rowMenu}
                onPlay={onPlay}
                onAdd={onAdd}
                onRemove={onRemove}
                onLabel={setLabelFor}
              />
            ) : plays.status === "reading" ? (
              <div className="space-y-2 p-4" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-5 animate-pulse rounded bg-fill-1" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-body text-muted-foreground">No plays match.</p>
                {(filtered || pick) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearAll}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </section>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="player" defaultSize="58" minSize="40">
          <section aria-label="Video" className="flex h-full min-h-0 min-w-0 flex-col p-4">
            {/* The footage as large as the column allows at 16:9, with the Now bar and the selection under it. */}
            <div ref={stageBox.ref} className="flex min-h-0 flex-1 flex-col items-center">
              <div className="flex flex-col" style={{ width: stageBox.width || "100%" }}>
                <TeamPlaysStage
                  video={video}
                  playback={playback}
                  why={playback.current ? plays.playable(playback.current.game.gameId) : null}
                  speed={speed}
                  onSpeedChange={setSpeed}
                  labels={labels}
                  assigned={(playback.currentKey && labelsOf(playback.currentKey)) || EMPTY_LABELS}
                  labelHandlers={labelHandlers}
                  labelOpen={labelOpen}
                  onLabelOpenChange={setLabelOpen}
                  lastLabel={labelKeys.lastLabel}
                  onLabelAgain={labelKeys.labelAgain}
                  keysShown={labelKeys.keysShown}
                  onAdd={add}
                  addCount={selected.size}
                  status={playback.currentKey ? collect.statusOf(playback.currentKey) : "none"}
                  targetName={collect.target?.name ?? null}
                />
              </div>
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
