import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Plus, Scissors, Tag, VideoOff, X } from "lucide-react";
import type { ClipKey, Label, LabelColor } from "@scoutable/shared/types/labels";
import {
  eventColors,
  eventLabel,
  formatGameClock,
  isBookkeepingEvent,
  playerName,
  sortPlaysChronologically,
} from "@scoutable/shared/lib/events";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { labelForKey, labelKeySlot } from "@scoutable/shared/lib/label-keys";
import { clickSelection, extendSelection, moveFocus, pruneSelection, selectAll, selectAllState, toggleKey, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { MAX_BROWSER_GAMES, orderForAdd, playerTeam, startGames, type StartSource } from "@scoutable/shared/lib/add-clips-games";
import { applyPresetFilters, presetLabelsGone, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import {
  keepKnownChoices,
  playerKey,
  playersByTeam,
  teamsOf,
} from "@scoutable/shared/lib/clip-filters";
import type { PlayByPlayEvent, Playlist, PlaylistClipItem, StoredMatch } from "@/types/match";
import { isClipItem } from "@/types/match";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { listEventsForMatchesChecked } from "@/lib/matches-db";
import { getAddClipsScope, setAddClipsScope } from "@/lib/prefs";
import { LABEL_KEY_TOAST, labelKeyMessage, toastNoLabelOnKey } from "@/lib/label-keys";
import { rememberLabelUsed } from "@/lib/recent-labels";
import { togglePlayerMuted } from "@/lib/player-sound";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { useFilterPresets } from "@/lib/use-filter-presets";
import { useListWindow } from "@/lib/use-list-window";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import type { VideoFileStatus } from "@/lib/video-probe";
import { cn } from "@/lib/utils";
import { LIST_GROUP, listSelecting, PLAY_ROW_HEIGHT, PlayRowCells, playRowClass, RowLabelButton, RowPlaylistSlot } from "@/components/plays/play-row";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import { FilterPresetsMenu } from "@/components/filter-presets-menu";
import { LeadersPopover } from "@/components/leaders-popover";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlaysFilterBar } from "@/components/plays/plays-filter-bar";
import { usePlayMoments } from "@/components/plays/use-play-moments";
import { EMPTY_PLAY_FILTERS, activeGroups, applyPlayFilters, playFiltersActive, type PlayFilters } from "@scoutable/shared/lib/play-filters";
import { BarAddButton, BarButton, PlaysCountLine } from "@/components/plays/plays-count-line";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { GamePicker, type GamePickVia } from "./game-picker";
import { PlayerStage } from "./player-stage";
import { GameNowBar } from "@/components/game/game-now-bar";
import { usePersistentVideo } from "./use-persistent-video";

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

// No Timeout chip: timeouts live in game marks, not in the play-by-play, so it would match nothing.

// ---------------------------------------------------------------------------
// A row in the browser
// ---------------------------------------------------------------------------

/** Every row is this tall, so the list can draw only the rows near the view (lib/use-list-window.ts). */

/** A play's key in the sheet: event ids repeat across games. */
const activeKeyOf = (x: { matchId: string; event: PlayByPlayEvent }) => `${x.matchId}:${x.event.eventId}`;

/** A clip with no labels: one array for every such row, so the row's memo holds. */
const NO_LABELS: Label[] = [];

/** The plays of these games a coach can watch: dead-ball possession markers stay out of the sheet. */
function watchablePlays(gameIds: readonly string[], plays: ReadonlyMap<string, PlayByPlayEvent[]>): PlayByPlayEvent[] {
  return gameIds.flatMap((id) => plays.get(id) ?? []).filter((e) => !isBookkeepingEvent(e));
}

/** The set with `add` in and `drop` out; the same set when that changes nothing, so the update renders nothing. */
function withGames(set: ReadonlySet<string>, add: readonly string[], drop: readonly string[]): ReadonlySet<string> {
  if (add.every((id) => set.has(id)) && drop.every((id) => !set.has(id))) return set;
  const next = new Set(set);
  for (const id of drop) next.delete(id);
  for (const id of add) next.add(id);
  return next;
}

/**
 * Memoised: a tick or a press re-renders only the rows whose props changed. Every
 * callback it gets keeps its identity across the panel's renders.
 */
const BrowserRow = memo(function BrowserRow({
  rowKey,
  index,
  event,
  matchId,
  matchTitle,
  showGame,
  isSelected,
  slot,
  slotWhere,
  targetName,
  isActive,
  assignedLabels,
  canLabel,
  labelPicker,
  onAdd,
  onPress,
  onLabel,
  onRemove,
  onDrag,
}: {
  /** `matchId:eventId`: event ids repeat across games. */
  rowKey: string;
  /** The row's place in the whole list (only rows near the view are drawn). */
  index: number;
  event: PlayByPlayEvent;
  matchId: string;
  matchTitle: string;
  showGame: boolean;
  isSelected: boolean;
  /** Whether the target has the play (rowSlot): +, ✓, ⇄ (in another part of it) or a still ✓. */
  slot: "none" | "in" | "added" | "elsewhere";
  /** "elsewhere": where the play sits now ("Keys"). */
  slotWhere?: string;
  /** What the row's + adds to ("this playlist", "#11 Nilsson"). */
  targetName: string;
  isActive: boolean;
  assignedLabels: Label[];
  /** Whether rows can be labelled at all (a space is active). */
  canLabel: boolean;
  /** The label picker, on the one row being labelled; null draws the plain Tag button. */
  labelPicker: React.ReactNode | null;
  /** The + at the row's end: adds this play (the selection, when the row is in it), as in the game view. */
  onAdd: (rowKey: string, anchor: HTMLElement) => void;
  /** The row: plain plays it, ⌘ selects it, Shift selects the range. */
  onPress: (event: PlayByPlayEvent, matchId: string, mods: { shift: boolean; toggle: boolean }) => void;
  /** The Tag button: opens the label picker on this row. */
  onLabel: (rowKey: string) => void;
  /** ✓ on a play the target has: takes it out (a report's section); undefined keeps the ✓ still. */
  onRemove?: (rowKey: string) => void;
  /** Docked beside a report: the row drags out onto it (PLAYS_DRAG_TYPE). */
  onDrag?: (rowKey: string, e: React.DragEvent) => void;
}) {
  return (
    <div
      role="row"
      data-row-key={rowKey}
      draggable={!!onDrag}
      onDragStart={onDrag ? (e) => onDrag(rowKey, e) : undefined}
      aria-rowindex={index + 1}
      aria-selected={isSelected}
      aria-current={isActive ? "true" : undefined}
      onClick={(e) => onPress(event, matchId, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      className={cn(
        // One height for every row, whatever it holds: the list is windowed by it (PLAY_ROW_HEIGHT).
        playRowClass({ selected: isSelected }),
        "box-border",
        // The separator goes by place in the list: the first row drawn isn't always the list's first.
        index > 0 && "shadow-[inset_0_1px_0_var(--separator)]",
        // The playing row, when it isn't selected: the current row's fill, a step lighter than the selection's.
        !isSelected && isActive && "bg-fill-2 hover:bg-fill-2",
      )}
    >
      <PlayRowCells
        event={event}
        clock="with-period"
        now={isActive}
        strong={isActive}
        team={null}
        labels={assignedLabels}
        context={showGame ? matchTitle : undefined}
        check={{ on: isSelected, onToggle: (shift) => onPress(event, matchId, { shift, toggle: !shift }) }}
        actions={
          <>
            {/* A plain button until it is pressed: the picker itself is mounted on one row at a time. */}
            {canLabel &&
              (labelPicker ?? <RowLabelButton title="Labels" aria-label="Labels" onClick={() => onLabel(rowKey)} />)}
            <RowPlaylistSlot
              status={slot}
              targetName={targetName}
              where={slotWhere}
              visible={isActive}
              onAdd={(anchor) => onAdd(rowKey, anchor)}
              onRemove={onRemove ? () => onRemove(rowKey) : undefined}
            />
          </>
        }
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The page owns the labels: one cache for every game, written through these,
 * so a label set here shows on the same clip in the open playlist at once.
 */
export interface ClipBrowserLabelHandlers {
  onToggleClip: (matchId: string, eventId: number, labelId: string, state: LabelTriState) => Promise<void>;
  onBulkToggle: (clips: ClipKey[], labelId: string, state: LabelTriState) => Promise<void>;
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Gives a label its key (1–9), or takes it away (null). */
  onSetKey: (id: string, slot: number | null) => Promise<void>;
  onSeedDefaults: () => Promise<void>;
}

/** The docked preview's widest: its 16:9 picture as tall as its part of the panel leaves after the controls (44), the Now bar (44) and the gaps. */
const DOCKED_STAGE_MAX_WIDTH = "calc((100cqh - 44px - 44px - 32px) * 16 / 9)";

/** What a dragged play carries (the docked panel's rows): its `matchId:eventId` keys, as JSON. */
export const PLAYS_DRAG_TYPE = "application/x-scoutable-plays";

/** The play keys a drop carries, or none for anything else dropped. */
export function readPlaysDrag(data: DataTransfer): string[] {
  try {
    const raw: unknown = JSON.parse(data.getData(PLAYS_DRAG_TYPE));
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** What a page asks of the docked panel: adds plays dropped on it (the target's value at the time). */
export interface ClipBrowserHandle {
  addKeys: (keys: string[]) => boolean;
}

/** A report's "Sorted by player": no section, each clip goes where its player is (report-draft.ts). */
export const SORTED_BY_PLAYER = "auto";

/**
 * Add clips to a part of what is open, not the whole of it: a scouting
 * report's sections. The header names the section (a menu changes it), a row
 * says where its play sits, ✓ in this section takes it out, ⇄ in another
 * moves it here (+ / A on it, or ticked with the rest).
 */
export interface ClipBrowserTarget {
  /** What the clips go into ("AIK · Sat 28 Nov"): "Add clips to {name}". */
  name: string;
  /** The parts to add to, in reading order; SORTED_BY_PLAYER first when it is offered. */
  options: readonly { id: string; label: string; hidden?: boolean }[];
  value: string;
  onChange: (id: string) => void;
  /** Where each play the report has sits, by `matchId:eventId` (id and label; "Not in report" for a left-out one). */
  placement: ReadonlyMap<string, { id: string; label: string }>;
  /** Plays the report has, elsewhere: moved to `value`. */
  onMove: (keys: string[]) => void;
  /** A play in `value`: taken out of the report. */
  onRemove: (key: string) => void;
}

/** What the sheet starts on when the page knows better than the last round (a report's opponent and player). */
export interface ClipBrowserStart {
  /** The games, when nothing was browsed for this target yet (latest first; the first MAX_BROWSER_GAMES). */
  games: readonly string[];
  /** Team names to filter to, kept only where the plays name them so. */
  teams: readonly string[];
  /** Player filter (playerKey()s), kept only where the plays have them. */
  players: readonly string[];
}

/**
 * Add clips to the open playlist: every imported game's play-by-play,
 * filtered down (the bar every list of plays has), previewed on its own stage
 * with the game view's Now bar, and added as the game view adds: a row's + or
 * A for one play, ⌘/Shift-click and the selection's pill for several, ✓ on
 * what the playlist has. Lives in a sheet over the editor and owns the keys
 * while it is open; Esc lets go of a selection before it closes the sheet.
 *
 * A coach adds in rounds (one player, then the next, from the same game), so
 * Add keeps the sheet open, and the sheet starts where the last round left
 * this playlist: those games and team (lib/prefs.ts), else the game the
 * playlist has most clips from, else the latest game (lib/add-clips-games.ts).
 * Several games are searched together (up to 10), and a player is one
 * person across them: the Player filter holds playerKey()s, not names.
 *
 * The sheet reads the plays of the games it shows itself (lib/matches-db.ts,
 * whose cache the page shares), so a change of games renders the sheet, not
 * the page behind it, and lands in one update.
 */
export const ClipBrowserPanel = memo(function ClipBrowserPanel({
  matches,
  matchLookup,
  playlist,
  onAddClips,
  activeOrgId,
  labels,
  labelAssignments,
  labelHandlers,
  onNeedLabels,
  videoStatusByMatch,
  preferredMatchId = null,
  target,
  start: given,
  layout = "sheet",
  onClose,
  handleRef,
  onPlay,
  pauseSignal = 0,
}: {
  /** The games to offer: read for their ids, titles, dates, teams and video, never their plays (the sheet reads those). */
  matches: StoredMatch[];
  matchLookup: Map<string, StoredMatch>;
  playlist: Playlist;
  /** The game to start on when the coach came here from it ("Build a playlist" on a game page). */
  preferredMatchId?: string | null;
  /** `already`: plays asked for that the target had (the page's toast says so, so the count adds up). */
  onAddClips: (clips: PlaylistClipItem[], info?: { already: number }) => void;
  activeOrgId: string | null;
  labels: Label[];
  /** The page's per-clip label sets, keyed `${matchId}:${eventId}`. */
  labelAssignments: Map<string, Set<string>>;
  labelHandlers: ClipBrowserLabelHandlers;
  /** Ask the page to load the labels on these games' clips if it hasn't yet. */
  onNeedLabels: (matchIds: string[]) => Promise<void>;
  /** Per-match video-file health from the page's probe (machine switches). */
  videoStatusByMatch: Map<string, VideoFileStatus>;
  /** Adding to a part of the playlist (a report's section); undefined adds to the playlist. */
  target?: ClipBrowserTarget;
  /** Where to start when nothing was browsed for this playlist yet, and the filters to start with. */
  start?: ClipBrowserStart;
  /**
   * "sheet": over the page, the list beside the preview, owning the keys while open. "panel": docked
   * beside a report, the preview under the list, rows dragged out onto the page; its keys are its
   * own only while the keyboard is inside it, and Esc there closes it (onClose).
   */
  layout?: "sheet" | "panel";
  onClose?: () => void;
  handleRef?: React.Ref<ClipBrowserHandle>;
  /** Its preview started playing (the page stops its own). */
  onPlay?: () => void;
  /** Goes up when the page plays something of its own: the preview pauses. */
  pauseSignal?: number;
}) {
  const docked = layout === "panel";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [start] = useState(() => {
    const scope = getAddClipsScope(playlist.id);
    const s = startGames(matches, playlist.items, scope?.gameIds ?? [], preferredMatchId);
    const givenGames = (given?.games ?? []).filter((id) => matches.some((m) => m.id === id)).slice(0, MAX_BROWSER_GAMES);
    const picked: { ids: string[]; source: StartSource | "given" } =
      s.source !== "remembered" && s.source !== "preferred" && givenGames.length > 0 ? { ids: givenGames, source: "given" } : s;
    const teams = s.source === "remembered" && picked === s ? (scope?.teams ?? []) : [...(given?.teams ?? [])];
    return { ...picked, teams };
  });
  const [gameIds, setGameIds] = useState<string[]>(start.ids);
  // Once per opening: where it started, and that start is now the playlist's last games.
  useEffect(() => {
    trackEvent("clip_browser_opened", { start: start.source, games_in_playlist: new Set(playlist.items.filter(isClipItem).map((c) => c.matchId)).size });
    if (start.ids.length > 0 && start.source !== "remembered") setAddClipsScope(playlist.id, { gameIds: start.ids, teams: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A given player is the filter from the start; pruned like any other once the games' plays are in.
  const [filters, setFilters] = useState<PlayFilters>(() =>
    given && given.players.length > 0 ? { ...EMPTY_PLAY_FILTERS, players: new Set(given.players) } : EMPTY_PLAY_FILTERS,
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const filterSearchRef = useRef<HTMLInputElement | null>(null);

  // The plays of every game the sheet has read, by game (kept when a game is unticked: ticking it again
  // reads nothing), and the games whose read failed, until they are read again.
  const [plays, setPlays] = useState<ReadonlyMap<string, PlayByPlayEvent[]>>(new Map());
  const playsRef = useRef(plays);
  const [failedGames, setFailedGames] = useState<ReadonlySet<string>>(new Set());
  // Keyed on the chosen ids, not the matches array: the page's matches change for reasons of its own.
  const gameIdsKey = gameIds.join(",");
  // The chosen games as of the last change (handleGameChange), for a read that lands later.
  const chosenKeyRef = useRef(gameIdsKey);
  // The team remembered with the games comes back once their plays are in, if they still have it.
  const pendingTeamsRef = useRef<string[] | null>(start.teams.length > 0 ? start.teams : null);

  /**
   * Reads the plays of `ask` (and the labels on the chosen games' clips) and lands them in one update:
   * the plays, which games failed and, while the chosen games are still `chosen` and all of them are
   * in, the team and players pruned to what those games have and the remembered team back. A chosen
   * game that failed may have the chosen players: nothing is pruned until it is in.
   */
  const readPlays = useCallback((ask: string[], chosen: string[]) => {
    const failAll = { byMatch: {} as Record<string, PlayByPlayEvent[]>, failed: ask };
    void Promise.all([
      listEventsForMatchesChecked(ask).catch(() => failAll),
      onNeedLabels(chosen).catch(() => {}),
    ]).then(([{ byMatch, failed }]) => {
      const failedNow = new Set(failed);
      const read = ask.filter((id) => !failedNow.has(id));
      const held = new Map(playsRef.current);
      // A game read with nothing for this reader (gone, or not theirs to see) has no plays to list.
      for (const id of read) held.set(id, byMatch[id] ?? []);
      playsRef.current = held;
      setPlays(held);
      // A game another read brought meanwhile stays in, whatever this one says.
      setFailedGames((prev) => withGames(prev, failed.filter((id) => !held.has(id)), read));
      // The games changed meanwhile: that change, or the read it started, prunes for them.
      if (chosenKeyRef.current !== chosen.join(",") || !chosen.every((id) => held.has(id))) return;
      const events = watchablePlays(chosen, held);
      const remembered = pendingTeamsRef.current;
      pendingTeamsRef.current = null;
      const known = new Set(remembered ? teamsOf(events) : []);
      const kept = remembered?.filter((t) => known.has(t)) ?? [];
      setFilters((f) => {
        const pruned = keepKnownChoices(f, events);
        return kept.length > 0 ? { ...pruned, teams: new Set(kept) } : pruned;
      });
    });
  }, [onNeedLabels]);

  // On open and on every change of games: the chosen games whose plays the sheet doesn't hold are read
  // (a failed one again). When it holds them all, the change pruned at once (handleGameChange).
  useEffect(() => {
    const ids = gameIdsKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !playsRef.current.has(id));
    if (missing.length > 0) readPlays(missing, ids);
    else void onNeedLabels(ids);
  }, [gameIdsKey, readPlays, onNeedLabels]);
  // A chosen game being read, neither in nor failed.
  const eventsLoading = gameIds.some((id) => !plays.has(id) && !failedGames.has(id));

  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // "matchId:eventId"
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueIdx, setQueueIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  // The row whose label picker is open (`matchId:eventId`): one picker for the list, on that row.
  const [labelPickerFor, setLabelPickerFor] = useState<string | null>(null);

  // One <video> for the sheet's life; the stage hosts it.
  const video = usePersistentVideo();
  const videoRef = useRef<HTMLVideoElement | null>(video);

  // Refs to avoid stale closures in the timeupdate handler
  const preRollRef = useRef(preRoll);
  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  const postRollRef = useRef(postRoll);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ event: PlayByPlayEvent; matchId: string } | null>(null);
  const queueRef = useRef<Array<{ event: PlayByPlayEvent; matchId: string }>>([]);
  const queueIdxRef = useRef(0);
  const activeEventKeyRef = useRef(activeEventKey);
  useEffect(() => { activeEventKeyRef.current = activeEventKey; }, [activeEventKey]);

  const existingSet = useMemo(
    () => new Set(playlist.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`)),
    [playlist.items],
  );
  /**
   * What a row's slot says: + (not there), ✓ just added here or in this section (a click takes it
   * out), ⇄ in another section (moves here), a still ✓ (there, nothing to do).
   */
  const slotOf = useCallback(
    (key: string): { status: "none" | "in" | "added" | "elsewhere"; where?: string } => {
      if (!target) return { status: existingSet.has(key) ? "in" : "none" };
      const at = target.placement.get(key);
      if (!at) return { status: existingSet.has(key) ? "in" : "none" };
      if (target.value === SORTED_BY_PLAYER) return { status: "in" };
      return at.id === target.value ? { status: "added" } : { status: "elsewhere", where: at.label };
    },
    [target, existingSet],
  );
  // Plays nothing can be done with here: never ticked, never added.
  const blockedSet = useMemo(() => {
    if (!target) return existingSet;
    const out = new Set<string>();
    for (const key of existingSet) {
      const s = slotOf(key).status;
      if (s === "in" || s === "added") out.add(key);
    }
    return out;
  }, [target, existingSet, slotOf]);
  // What a + adds to: the section, or the report as a whole when its clips go where their players are.
  const targetLabel = target
    ? target.value === SORTED_BY_PLAYER
      ? "report"
      : (target.options.find((o) => o.id === target.value)?.label ?? target.name)
    : "this playlist";
  const onRowRemove = useMemo(() => (target && target.value !== SORTED_BY_PLAYER ? (key: string) => target.onRemove(key) : undefined), [target]);

  const gameIdSet = useMemo(() => new Set(gameIds), [gameIds]);
  // The chosen games in the page's order, each with the plays the sheet holds for it.
  const chosenGames = useMemo(
    () => matches.filter((m) => gameIdSet.has(m.id)).map((m) => ({ ...m, events: sortPlaysChronologically(plays.get(m.id) ?? []) })),
    [matches, gameIdSet, plays],
  );
  const allEvents = useMemo(() => {
    return chosenGames.flatMap((m) =>
      m.events
        // Dead-ball possession markers aren't watchable — keep them out of
        // the browser and everything derived from it (teams, players, counts).
        .filter((e) => !isBookkeepingEvent(e))
        .map((e) => ({ event: e, matchId: m.id, matchTitle: m.title })),
    );
  }, [chosenGames]);

  const teams = useMemo(
    () => Array.from(new Set(allEvents.map((x) => x.event.eventTeam?.teamName).filter(Boolean) as string[])),
    [allEvents],
  );
  const playerGroups = useMemo(() => {
    const source = filters.teams.size > 0
      ? allEvents.filter(({ event }) => filters.teams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    return playersByTeam(source.map((x) => x.event));
  }, [allEvents, filters.teams]);
  // Same Game + Team narrowing as the players list, so the Leaders popover
  // never offers a player the Team filter would immediately hide.
  const leaderEvents = useMemo(() => {
    const source = filters.teams.size > 0
      ? allEvents.filter(({ event }) => filters.teams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    return source.map((x) => x.event);
  }, [allEvents, filters.teams]);

  // The Leaders popover speaks names; the Player filter holds keys. A name
  // stands for every listed key with that name (two people can share one).
  const keyNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of playerGroups) for (const pl of g.players) out.set(pl.key, pl.name);
    return out;
  }, [playerGroups]);
  const leaderSelected = useMemo(() => {
    const out = new Set<string>();
    for (const key of filters.players) {
      const name = keyNames.get(key);
      if (name) out.add(name);
    }
    return out;
  }, [filters.players, keyNames]);
  const handleLeaderToggle = useCallback((name: string) => {
    const keys = [...keyNames].filter(([, n]) => n === name).map(([key]) => key);
    if (keys.length === 0) return;
    setFilters((f) => {
      const next = new Set(f.players);
      const on = keys.some((k) => next.has(k));
      for (const k of keys) {
        if (on) next.delete(k);
        else next.add(k);
      }
      return { ...f, players: next };
    });
  }, [keyNames]);

  // The When section: the quarters the chosen games have, and each game's moments.
  const momentGames = useMemo(() => chosenGames.map((m) => ({ gameId: m.id, events: m.events, gameMarks: m.gameMarks ?? null })), [chosenGames]);
  const moments = usePlayMoments(momentGames);
  const periods = useMemo(() => [...new Set(allEvents.map((x) => x.event.period))].sort((a, b) => a - b), [allEvents]);

  /** Whether any filter narrows the list: the count line offers Clear filters. */
  const anyFilter = playFiltersActive(filters);
  const filtered = useMemo(
    () =>
      applyPlayFilters(
        allEvents,
        filters,
        (x) => labelAssignments.get(`${x.matchId}:${x.event.eventId}`),
        (x) => moments.momentsOf(x.matchId, x.event.eventId),
      ),
    [allEvents, filters, labelAssignments, moments],
  );

  // The listed plays' keys: what select all, the select-all check and the selection's pruning go by.
  const filteredKeys = useMemo(() => filtered.map(({ event, matchId }) => `${matchId}:${event.eventId}`), [filtered]);
  // The selection is what will be added: a filter or game change that hides selected plays lets go of them.
  useEffect(() => setSelectedIds((prev) => pruneSelection(prev, filteredKeys) as Set<string>), [filteredKeys]);
  const selectState = useMemo(() => selectAllState(filteredKeys, selectedIds, blockedSet), [filteredKeys, selectedIds, blockedSet]);
  const selectable = useMemo(() => filteredKeys.reduce((n, k) => (blockedSet.has(k) ? n : n + 1), 0), [filteredKeys, blockedSet]);

  // A filter change is one event once the coach has stopped changing it (the game view's game_view_filtered).
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) {
      firstFilter.current = false;
      return;
    }
    const timer = window.setTimeout(() => trackEvent("plays_filtered", { surface: "add_clips", groups: activeGroups(filters), visible: filtered.length }), 800);
    return () => window.clearTimeout(timer);
    // The count rides along; it isn't what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Each clip's labels, in the vocabulary's order: one array per clip, rebuilt only when the labels
  // or what is put on the clips change (a row is memoised on it).
  const labelsByKey = useMemo(() => {
    const out = new Map<string, Label[]>();
    for (const [key, ids] of labelAssignments) {
      const on = labels.filter((l) => ids.has(l.id));
      if (on.length > 0) out.set(key, on);
    }
    return out;
  }, [labels, labelAssignments]);

  const selectedClipKeyPairs = useMemo<ClipKey[]>(() => {
    const out: ClipKey[] = [];
    for (const key of selectedIds) {
      const [matchId, eventIdStr] = key.split(":");
      const eventId = Number(eventIdStr);
      if (matchId && Number.isFinite(eventId)) out.push({ matchId, eventId });
    }
    return out;
  }, [selectedIds]);

  const { bulkAssignedAll, bulkAssignedSome } = useMemo(() => {
    const all = new Set<string>();
    const some = new Set<string>();
    if (selectedClipKeyPairs.length === 0) return { bulkAssignedAll: all, bulkAssignedSome: some };
    const counts = new Map<string, number>();
    for (const { matchId, eventId } of selectedClipKeyPairs) {
      const s = labelAssignments.get(`${matchId}:${eventId}`);
      if (!s) continue;
      for (const id of s) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = selectedClipKeyPairs.length;
    for (const [id, n] of counts.entries()) {
      if (n === total) all.add(id);
      else if (n > 0) some.add(id);
    }
    return { bulkAssignedAll: all, bulkAssignedSome: some };
  }, [selectedClipKeyPairs, labelAssignments]);

  // A change of games keeps the chosen team and players (a player id is the
  // same in every game, so "#8, last 5 games" keeps #8) and prunes those the
  // new games don't have once their plays are in: here when the sheet holds
  // them all, else when their read lands (readPlays), in one update either way.
  function handleGameChange(ids: string[], via: GamePickVia) {
    pendingTeamsRef.current = null;
    const same = ids.join(",") === chosenKeyRef.current;
    chosenKeyRef.current = ids.join(",");
    setGameIds(ids);
    setAddClipsScope(playlist.id, { gameIds: ids, teams: [...filters.teams] });
    trackEvent("clip_browser_games_set", { games: ids.length, via });
    // The same games again (a row press on the one chosen game, "Last 5 games" twice): no change of
    // games, so nothing below reads them; it is a Try again for those whose read failed, else nothing.
    if (same) {
      retryFailed(ids);
      return;
    }
    // A chosen game whose read failed is read again: loading until it lands, not failed.
    setFailedGames((prev) => withGames(prev, [], ids));
    const held = playsRef.current;
    if (ids.every((id) => held.has(id))) {
      const events = watchablePlays(ids, held);
      setFilters((f) => keepKnownChoices(f, events));
    }
  }

  // The chosen games whose read failed, named above the list.
  const failedChosen = chosenGames.filter((m) => failedGames.has(m.id));
  /** Reads again only those of the chosen games whose read failed: loading until it lands, not failed. */
  function retryFailed(chosen: string[]) {
    const ids = chosen.filter((id) => failedGames.has(id));
    if (ids.length === 0) return;
    setFailedGames((prev) => withGames(prev, [], ids));
    readPlays(ids, chosen);
  }

  /** A change of team, from the Filter popover: remembered with the games, and the players narrowed to it. */
  function handleTeamChange(newTeams: Set<string>, rest: PlayFilters = filters) {
    pendingTeamsRef.current = null;
    if (gameIds.length > 0) setAddClipsScope(playlist.id, { gameIds, teams: [...newTeams] });
    const source = newTeams.size > 0
      ? allEvents.filter(({ event }) => newTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    const validPlayers = new Set(source.map((x) => playerKey(x.event)).filter((k): k is string => k !== null));
    setFilters({ ...rest, teams: newTeams, players: new Set([...rest.players].filter((p) => validPlayers.has(p))) });
  }

  // A preset holds plays, shot types, situations and labels, never games, teams or players: applying
  // one leaves the chosen games, team and players as they are, so the same preset serves any player.
  // Nothing in it depends on the games' plays, so it applies at once, loading or not; a label the space
  // no longer has is left out, and the coach is told when that leaves none.
  const presets = useFilterPresets(activeOrgId, "add_clips");
  function applyPreset(p: FilterPreset) {
    const labelIds = labels.map((l) => l.id);
    setFilters((f) => applyPresetFilters(f, p.filters, labelIds));
    presets.applied(p);
    if (presetLabelsGone(p.filters, labelIds)) toast("This preset's labels no longer exist, so they weren't applied");
  }

  // "Last 5 games of …" in the Game picker: the one chosen player's team, else the one chosen team.
  const quickTeam = useMemo(() => {
    if (filters.players.size === 1) return playerTeam(chosenGames, [...filters.players][0]);
    if (filters.teams.size === 1) return [...filters.teams][0];
    return null;
  }, [chosenGames, filters.players, filters.teams]);

  // Each play's place in the list, by `matchId:eventId`: no scan of every play to find one.
  const indexByKey = useMemo(() => {
    const out = new Map<string, number>();
    filtered.forEach(({ event, matchId }, i) => out.set(`${matchId}:${event.eventId}`, i));
    return out;
  }, [filtered]);
  // Five games are some 1,800 plays: only the rows near the view are drawn.
  const { scrollRef: listScrollRef, range: listRange, reveal: revealRow } = useListWindow({
    count: filtered.length,
    rowHeight: PLAY_ROW_HEIGHT,
  });

  // Keep ref for the key handler (avoids stale closures)
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const indexByKeyRef = useRef(indexByKey);
  indexByKeyRef.current = indexByKey;

  const videoMatchId = activeEventKey ? activeEventKey.split(":")[0] : gameIds[0] ?? null;
  const localVideoUrl = useMemo(() => {
    const match = videoMatchId ? matchLookup.get(videoMatchId) : null;
    if (!match?.videoUrl) return null;
    return isLocalPath(match.videoUrl) ? streamFileSrc(match.videoUrl) : match.videoUrl;
  }, [videoMatchId, matchLookup]);
  // Which game's footage the element currently holds: a click on another
  // game's event must wait for its file before seeking (see pendingSeekRef).
  const loadedMatchIdRef = useRef<string | null>(null);
  useEffect(() => {
    loadedMatchIdRef.current = localVideoUrl ? videoMatchId : null;
  }, [localVideoUrl, videoMatchId]);

  // Full screen, as in the editor: native window full screen plus a fixed
  // layer for the stage. The sheet owns it while it is open: F, double-click,
  // the transport button and View → Fullscreen Player (the editor behind the
  // sheet ignores that menu while the sheet is up). It needs footage to show,
  // and it never outlives the sheet or the video.
  const playerFs = usePlayerFullscreen();
  const playerFsRef = useRef(playerFs);
  playerFsRef.current = playerFs;
  const hasStageRef = useRef(false);
  hasStageRef.current = !!localVideoUrl;
  const toggleFullscreen = useCallback(() => {
    if (!playerFsRef.current.active && !hasStageRef.current) return;
    playerFsRef.current.toggle();
  }, []);
  useEffect(() => {
    const onToggle = () => toggleFullscreen();
    window.addEventListener("player-fullscreen-toggle", onToggle);
    return () => window.removeEventListener("player-fullscreen-toggle", onToggle);
  }, [toggleFullscreen]);
  // Escape leaves full screen instead of closing the sheet: this capture
  // listener on window runs before the dialog's own Escape handling.
  useEffect(() => {
    if (!playerFs.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      void playerFsRef.current.exit();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [playerFs.active]);
  useEffect(() => {
    if (!localVideoUrl && playerFsRef.current.active) void playerFsRef.current.exit();
  }, [localVideoUrl]);
  useEffect(() => () => {
    if (playerFsRef.current.active) void playerFsRef.current.exit();
  }, []);

  // Seek to an event — pause → seek → play, sets clipEnd for auto-advance
  const seekToEvent = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const match = matchLookup.get(matchId);
    const el = videoRef.current;
    if (!match?.syncPoint || !el) return;
    const videoTime = computeVideoTime(event, match.syncPoint);
    if (videoTime === null) return;
    const seekTo = Math.max(0, videoTime - preRollRef.current);
    const clipEnd = videoTime + postRollRef.current;
    clipEndRef.current = undefined;
    el.pause();
    const target1 = seekTo;
    function onSeeked1() {
      if (el!.currentTime > target1 + 2) { el!.addEventListener("seeked", onSeeked1, { once: true }); return; }
      clipEndRef.current = clipEnd;
      el!.play().catch(() => {});
    }
    el.addEventListener("seeked", onSeeked1, { once: true });
    el.currentTime = seekTo;
  }, [matchLookup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep seek ref current so timeupdate handler always calls the latest version
  const seekToEventRef = useRef(seekToEvent);
  seekToEventRef.current = seekToEvent;

  // Auto-advance to next clip via timeupdate
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !el) return;
      if (el.currentTime < end) return;
      // Guard: if we're >60s past clipEnd the video is at a stale position (seek in progress)
      if (el.currentTime > end + 60) return;

      clipEndRef.current = undefined;
      el.pause();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;

      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        setQueueIdx(nextIdx);
        const { event, matchId } = queue[nextIdx];
        const key = `${matchId}:${event.eventId}`;
        setActiveEventKey(key);
        activeEventKeyRef.current = key;
        if (loadedMatchIdRef.current === matchId) seekToEventRef.current(event, matchId);
        else pendingSeekRef.current = { event, matchId };
      } else {
        el.pause();
        setIsPlaying(false);
        setActiveEventKey(null);
        queueRef.current = [];
      }
    }

    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [localVideoUrl]);

  // Deferred seek: fires once the stage has loaded the event's game.
  useEffect(() => {
    const pending = pendingSeekRef.current;
    const el = videoRef.current;
    if (!pending || !el || !localVideoUrl) return;
    if (pending.matchId !== videoMatchId) return;
    pendingSeekRef.current = null;
    const doSeek = () => seekToEvent(pending.event, pending.matchId);
    if (el.readyState >= 1) doSeek();
    else el.addEventListener("loadedmetadata", doSeek, { once: true });
  }, [localVideoUrl, videoMatchId, seekToEvent]);

  // The page is told when the preview plays (it stops its own), and pauses the preview when it plays.
  useEffect(() => {
    if (!onPlay) return;
    video.addEventListener("play", onPlay);
    return () => video.removeEventListener("play", onPlay);
  }, [video, onPlay]);
  useEffect(() => {
    if (pauseSignal > 0) video.pause();
  }, [pauseSignal, video]);

  // Stop playback when the sheet closes; the element outlives the stage.
  useEffect(() => () => { video.pause(); }, [video]);

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setQueueIdx(0);
    clipEndRef.current = undefined;
    setIsPlaying(false);
    setActiveEventKey(null);
    videoRef.current?.pause();
  }

  function handleReplay() {
    const item = queueRef.current[queueIdxRef.current];
    if (item) seekToEvent(item.event, item.matchId);
  }
  const handleReplayRef = useRef(handleReplay);
  handleReplayRef.current = handleReplay;

  const handleRowClick = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const items = filteredRef.current;
    const idx = indexByKeyRef.current.get(`${matchId}:${event.eventId}`) ?? -1;
    const queue = idx >= 0 ? items.slice(idx) : [{ event, matchId, matchTitle: "" }];

    queueRef.current = queue;
    queueIdxRef.current = 0;
    setQueueIdx(0);
    setIsPlaying(true);
    setActiveEventKey(`${matchId}:${event.eventId}`);

    if (loadedMatchIdRef.current === matchId) {
      seekToEvent(event, matchId);
    } else {
      // Another game: the stage swaps the file first, the effect above seeks.
      pendingSeekRef.current = { event, matchId };
    }
  }, [seekToEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleRowClickRef = useRef(handleRowClick);
  handleRowClickRef.current = handleRowClick;

  /** The playing play's place in the list; -1 for none, or one the filters hide. */
  const playingIndex = () => {
    const key = activeEventKeyRef.current;
    return key === null ? -1 : (indexByKeyRef.current.get(key) ?? -1);
  };

  function handlePrev() {
    const items = filteredRef.current;
    const cur = playingIndex();
    if (cur <= 0) return;
    const { event, matchId } = items[cur - 1];
    handleRowClickRef.current(event, matchId);
  }

  function handleNext() {
    const items = filteredRef.current;
    const cur = playingIndex();
    if (cur === -1 || cur >= items.length - 1) return;
    const { event, matchId } = items[cur + 1];
    handleRowClickRef.current(event, matchId);
  }

  function handlePlayAll() {
    const items = filteredRef.current;
    if (items.length === 0) return;
    handleRowClick(items[0].event, items[0].matchId);
  }

  const activeIdx = activeEventKey === null ? -1 : (indexByKey.get(activeEventKey) ?? -1);
  const activeEntry = activeIdx >= 0 ? filtered[activeIdx] : null;
  // Esc lets go of a selection first and closes the sheet only after, as Finder does. The sheet closes on Esc
  // at the document (Radix), so this listens before it, on the window; a menu or popover open over the sheet
  // takes its own Esc.
  const selectionSizeRef = useRef(0);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  /** A docked row dragged out: the selection when the row is in it (Finder's rule), else that play. */
  const onRowDrag = useCallback((key: string, e: React.DragEvent) => {
    const keys = selectedIdsRef.current.has(key) ? [...selectedIdsRef.current] : [key];
    e.dataTransfer.setData(PLAYS_DRAG_TYPE, JSON.stringify(keys));
    e.dataTransfer.effectAllowed = "copy";
  }, []);
  const dockedRef = useRef(docked);
  dockedRef.current = docked;
  selectionSizeRef.current = selectedIds.size;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || selectionSizeRef.current === 0) return;
      // Docked, an Esc from elsewhere on the page is the page's.
      if (dockedRef.current && !panelRef.current?.contains(document.activeElement)) return;
      if (document.querySelector('[data-slot="popover-content"], [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // The Now bar's label picker (G), and its Add.
  const [nowLabelOpen, setNowLabelOpen] = useState(false);
  const nowAddRef = useRef<HTMLButtonElement | null>(null);
  const canPrev = isPlaying && activeIdx > 0;
  const canNext = isPlaying && activeIdx >= 0 && activeIdx < filtered.length - 1;
  const isQueueActive = isPlaying;

  const clipWindow = useMemo(() => {
    if (!activeEntry) return null;
    const m = matchLookup.get(activeEntry.matchId);
    if (!m?.syncPoint) return null;
    const t = computeVideoTime(activeEntry.event, m.syncPoint);
    return t === null ? null : clipBounds(t, preRoll, postRoll);
  }, [activeEntry, matchLookup, preRoll, postRoll]);
  const clipWindowRef = useRef(clipWindow);
  clipWindowRef.current = clipWindow;

  function toggleOne(key: string) {
    setSelectedIds((prev) => toggleKey(prev, key));
  }

  // Ticking the way the editor's list selects (list-selection.ts): a plain
  // or ⌘ click, a tick and a plain arrow set the anchor; Shift-click and
  // Shift+arrows tick everything from it to the clip. Clips already in the
  // playlist are never ticked.
  const anchorKeyRef = useRef<string | null>(null);
  const extendFocusRef = useRef<string | null>(null);
  function setAnchor(key: string | null) {
    anchorKeyRef.current = key;
    extendFocusRef.current = key;
  }
  const orderOf = () => filteredRef.current.map(({ event, matchId }) => `${matchId}:${event.eventId}`);
  function withoutExisting(keys: Set<string>) {
    for (const key of blockedSet) keys.delete(key);
    return keys;
  }
  function applyClick(key: string, shift: boolean, toggle: boolean) {
    if (!shift && blockedSet.has(key)) {
      setAnchor(key);
      return;
    }
    const next = clickSelection({
      order: orderOf(),
      selected: selectedIds,
      anchor: anchorKeyRef.current,
      focus: extendFocusRef.current,
      key,
      shift,
      toggle,
    });
    setSelectedIds(withoutExisting(next.selected));
    anchorKeyRef.current = next.anchor;
    extendFocusRef.current = next.focus;
  }
  function handleRowPress(event: PlayByPlayEvent, matchId: string, mods: { shift: boolean; toggle: boolean }) {
    const key = `${matchId}:${event.eventId}`;
    if (mods.shift || mods.toggle) {
      applyClick(key, mods.shift, !mods.shift);
      return;
    }
    setAnchor(key);
    handleRowClick(event, matchId);
  }
  // What the rows are handed: made once, calling the latest handlers, so a row's memo holds.
  const handleRowPressRef = useRef(handleRowPress);
  handleRowPressRef.current = handleRowPress;
  const onRowPress = useCallback(
    (event: PlayByPlayEvent, matchId: string, mods: { shift: boolean; toggle: boolean }) => handleRowPressRef.current(event, matchId, mods),
    [],
  );
  const onRowAdd = useCallback((key: string) => addFromRowRef.current(key), []);
  const onRowLabel = useCallback((key: string) => setLabelPickerFor(key), []);
  function playKey(key: string) {
    const idx = indexByKeyRef.current.get(key);
    const item = idx === undefined ? undefined : filteredRef.current[idx];
    if (item) handleRowClickRef.current(item.event, item.matchId);
  }
  /** ↑/↓, Home/End, ⌘↑/⌘↓: play the clip there. */
  function walk(move: FocusMove) {
    const to = moveFocus(orderOf(), activeEventKeyRef.current, move);
    if (to === null) return;
    if (to !== activeEventKeyRef.current) playKey(to);
    setAnchor(to);
  }
  /** Shift+arrows: tick from the anchor to the clip there, and play it. */
  function extendTicks(move: FocusMove) {
    const order = orderOf();
    const from = extendFocusRef.current ?? activeEventKeyRef.current;
    const to = moveFocus(order, from, move);
    if (to === null) return;
    const shown = (key: string | null): key is string => key !== null && order.includes(key);
    const anchor = shown(anchorKeyRef.current) ? anchorKeyRef.current : shown(from) ? from : to;
    setSelectedIds((prev) =>
      withoutExisting(extendSelection({ order, selected: prev, anchor, previousFocus: shown(from) ? from : null, focus: to })),
    );
    anchorKeyRef.current = anchor;
    extendFocusRef.current = to;
    if (to !== activeEventKeyRef.current) playKey(to);
  }
  /** ←/→ within the playing clip (Shift: further), as in the editor. */
  function nudge(delta: number) {
    const el = videoRef.current;
    if (!el) return;
    const w = clipWindowRef.current;
    const lo = w ? w.start : 0;
    const hi = w ? Math.max(w.start, w.end - 0.05) : el.duration || 0;
    el.currentTime = Math.min(hi, Math.max(lo, el.currentTime + delta));
  }

  /**
   * Adds every ticked clip the playlist doesn't have, as the button counts
   * them (filtered out of view or not), in game order, and stays open for
   * the next round: the ticks clear, the filters stay.
   */
  /** Adds these plays (those the playlist doesn't have), in game order; the page says "5 clips added" with an Undo. */
  function addKeys(keysIn: Iterable<string>, opts: { elsewhere?: boolean } = {}): boolean {
    const keys = [...keysIn];
    // Every game the sheet holds, not only the chosen ones: a selection stays across a change of games.
    const held = playsRef.current;
    const games = matches.filter((m) => held.has(m.id)).map((m) => ({ ...m, events: held.get(m.id)! }));
    // To another section than the one shown (the row menu's Add to section): what this one has counts too.
    const wanted = opts.elsewhere ? [...keys] : [...keys].filter((k) => !blockedSet.has(k));
    const toAdd = orderForAdd(wanted.filter((k) => !existingSet.has(k)), games);
    // A report's play in another section moves here; the page says so with its own Undo.
    const toMove = target ? wanted.filter((k) => existingSet.has(k)) : [];
    if (toAdd.length === 0 && toMove.length === 0) return false;
    if (toAdd.length > 0) onAddClips(toAdd, { already: keys.length - wanted.length });
    if (toMove.length > 0) target!.onMove(toMove);
    return true;
  }
  // Plays dropped on the page (the docked panel's rows): added as the + adds them, to the target as it is then.
  const addKeysRef = useRef(addKeys);
  addKeysRef.current = addKeys;
  useImperativeHandle(
    handleRef,
    () => ({
      addKeys: (keys) => {
        const added = addKeysRef.current(keys);
        // A drop of the selection lets go of it, as every other add does; a single unselected row leaves it.
        const sel = selectedIdsRef.current;
        if (added && keys.length === sel.size && keys.every((k) => sel.has(k))) setSelectedIds(new Set());
        return added;
      },
    }),
    [],
  );

  /** The selection's Add (⌘↩): the selected plays go in, and the sheet stays open for the next round. */
  function handleAdd() {
    if (addKeys(selectedIds)) setSelectedIds(new Set());
  }
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;
  /** A row's +: the selection when the row is in it (Finder's rule), else that play alone. */
  function addFromRow(key: string) {
    if (selectedIds.has(key)) handleAdd();
    else addKeys([key]);
  }
  const addFromRowRef = useRef(addFromRow);
  addFromRowRef.current = addFromRow;
  /** A: the selection, else the play on screen. */
  function addFromKey() {
    if (selectedIds.size > 0) handleAdd();
    else if (activeEventKeyRef.current) addKeys([activeEventKeyRef.current]);
  }

  /** The row a right-click opened the list's menu on. */
  const [menuKey, setMenuKey] = useState<string | null>(null);
  /**
   * A row's menu, as the game view's and Team Plays': Add to the target (the selection when the row is in it,
   * Finder's rule), Add to another section of a report, and select all.
   */
  function rowMenu(key: string) {
    const keys = selectedIds.has(key) ? [...selectedIds] : [key];
    const n = keys.filter((k) => !blockedSet.has(k)).length;
    const others = target ? target.options.filter((o) => o.id !== target.value) : [];
    return (
      <ContextMenuContent className="min-w-56">
        <ContextMenuItem disabled={n === 0} onSelect={() => (selectedIds.has(key) ? handleAdd() : addKeys([key]))}>
          {n === 0 ? `In ${targetLabel}` : n === 1 ? `Add to ${targetLabel}` : `Add ${n} plays to ${targetLabel}`}
        </ContextMenuItem>
        {others.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{keys.length === 1 ? "Add to section" : `Add ${keys.length} to section`}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-80 overflow-y-auto">
              {others.map((o) => (
                <ContextMenuItem
                  key={o.id}
                  onSelect={() => {
                    // The section becomes the panel's target (the page reads it as the plays land), then they go in.
                    target!.onChange(o.id);
                    if (addKeys(keys, { elsewhere: true }) && selectedIds.has(key)) setSelectedIds(new Set());
                  }}
                >
                  {o.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={selectable === 0} onSelect={() => setSelectedIds(selectAll(filteredKeys, blockedSet))}>
          Select all {selectable}
        </ContextMenuItem>
        {selectedIds.size > 0 && <ContextMenuItem onSelect={() => setSelectedIds(new Set())}>Deselect all</ContextMenuItem>}
      </ContextMenuContent>
    );
  }

  const isMultiMatch = gameIds.length > 1;

  /**
   * A label's own key (⌥1–⌥9): the label goes on the clip that is playing, or comes off it. The
   * ticks are what will be added, not what is being labelled, so they are left to "Apply label".
   */
  const labelByKey = (slot: number) => {
    if (!activeOrgId) return;
    const label = labelForKey(labels, slot);
    if (!label) {
      toastNoLabelOnKey(slot);
      return;
    }
    const key = activeEventKeyRef.current;
    const idx = key ? indexByKeyRef.current.get(key) : undefined;
    const playing = idx === undefined ? undefined : filteredRef.current[idx];
    if (!key || !playing) return;
    const { matchId, event } = playing;
    const on = !(labelAssignments.get(key)?.has(label.id) ?? false);
    void labelHandlers.onToggleClip(matchId, event.eventId, label.id, on ? "none" : "all");
    if (on) {
      rememberLabelUsed(label.id);
      trackEvent("label_picked", { by: "hotkey", position: slot, recent: false, searched: false, created: false });
    }
    toast(labelKeyMessage(label.name, on), {
      id: LABEL_KEY_TOAST,
      action: { label: "Undo", onClick: () => void labelHandlers.onToggleClip(matchId, event.eventId, label.id, on ? "all" : "none") },
    });
  };

  // Keys belong to the sheet while it is open (one owner at a time), the
  // editor's where they make sense here: ↑/↓, Home/End and ⌘↑/⌘↓ walk the
  // clips, Shift with them ticks the range, ←/→ nudge (Shift: further),
  // J/K/L shuttle, Space plays, R replays, F is full screen. Return selects the
  // playing clip, ⌘A selects every shown clip, ⌘↩ adds the selection, A adds
  // (the selection, else the clip on screen), G labels the clip on screen.
  // Docked, the keys are the panel's only while the keyboard is in it; the report keeps its own otherwise.
  const [focusInside, setFocusInside] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!docked || !el) return;
    const sync = () => setFocusInside(el.contains(document.activeElement));
    // Focus moving within the panel leaves it for a moment: read where it landed.
    const later = () => window.setTimeout(sync, 0);
    el.addEventListener("focusin", sync);
    el.addEventListener("focusout", later);
    return () => {
      el.removeEventListener("focusin", sync);
      el.removeEventListener("focusout", later);
    };
  }, [docked]);
  useKeyScope("clip-browser", !docked || focusInside, panelRef);
  useHotkeys("clip-browser", (e) => {
    // Docked: Esc puts the panel away (a selection went first, in the capture listener above).
    if (docked && e.key === "Escape") {
      e.preventDefault();
      onClose?.();
      return;
    }
    // ⌘F: the Filter popover with its search, as in the game view and Teams' Plays.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyF") {
      e.preventDefault();
      setFilterOpen(true);
      window.setTimeout(() => filterSearchRef.current?.focus(), 50);
      return;
    }
    const labelKey = labelKeySlot(e);
    if (labelKey !== null) {
      e.preventDefault();
      // A held key would put the label on and take it off again.
      if (!e.repeat) labelByKey(labelKey);
      return;
    }
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    // A adds the selection, else the play on screen; G labels the play on screen: as in the game view.
    if (plain && !e.shiftKey && e.code === "KeyA") {
      e.preventDefault();
      addFromKey();
      return;
    }
    if (plain && !e.shiftKey && e.code === "KeyG") {
      e.preventDefault();
      if (activeEventKeyRef.current && activeOrgId) setNowLabelOpen(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        handleAddRef.current();
        return;
      }
      const key = activeEventKeyRef.current;
      if (key && !blockedSet.has(key)) toggleOne(key);
      if (key) setAnchor(key);
      return;
    }
    const action = resolvePlayerKey(e);
    if (action === "select-all") {
      e.preventDefault();
      // Every listed play the target can still take (those it has can't be added again).
      setSelectedIds(selectAll(orderOf(), blockedSet));
      return;
    }
    if (action === "toggle-play") {
      e.preventDefault();
      const el = videoRef.current;
      if (!el) return;
      if (!isPlaying && el.paused) { handlePlayAll(); return; }
      if (el.paused) el.play().catch(() => {});
      else el.pause();
      return;
    }
    if (action === "replay") { e.preventDefault(); handleReplayRef.current(); return; }
    if (action === "fullscreen") { e.preventDefault(); toggleFullscreen(); return; }
    if (action === "toggle-mute") { e.preventDefault(); togglePlayerMuted({ announce: true }); return; }
    switch (action) {
      case "nudge-back":
      case "nudge-forward":
      case "nudge-back-far":
      case "nudge-forward-far": {
        e.preventDefault();
        const far = action.endsWith("-far");
        nudge((action.startsWith("nudge-back") ? -1 : 1) * (far ? NUDGE_FAR_SECONDS : NUDGE_SECONDS));
        return;
      }
      case "shuttle-pause":
        e.preventDefault();
        videoRef.current?.pause();
        return;
      case "shuttle-forward": {
        e.preventDefault();
        const el = videoRef.current;
        if (!el) return;
        setSpeed(nextShuttleRate(speed));
        if (el.paused) el.play().catch(() => {});
        return;
      }
      case "shuttle-back":
        // WebKit has no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "next":
      case "prev":
      case "first":
      case "last":
        if (filteredRef.current.length === 0) return;
        e.preventDefault();
        walk(action === "next" ? 1 : action === "prev" ? -1 : action);
        return;
      case "extend-next":
      case "extend-prev":
      case "extend-first":
      case "extend-last":
        if (filteredRef.current.length === 0) return;
        e.preventDefault();
        extendTicks(
          action === "extend-next" ? 1 : action === "extend-prev" ? -1 : action === "extend-first" ? "first" : "last",
        );
        return;
    }
  });

  // Keep the playing row in view (it may not be drawn yet: the list scrolls to its place). Before
  // paint, so a jump (End, Home, the next clip) never shows a frame of empty list. Not while a row
  // is being labelled: that row must stay drawn. When the picker closes, the list moves only if
  // another clip started meanwhile; otherwise it stays where the coach scrolled it.
  const revealedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (activeEventKey === null) {
      revealedKeyRef.current = null;
      return;
    }
    if (labelPickerFor !== null || activeEventKey === revealedKeyRef.current) return;
    revealedKeyRef.current = activeEventKey;
    revealRow(indexByKeyRef.current.get(activeEventKey));
  }, [activeEventKey, labelPickerFor, revealRow]);

  // The labelled row has left the list (its label filtered it out, another game) or is no longer
  // drawn: its picker went with it.
  useEffect(() => {
    if (labelPickerFor === null) return;
    const index = indexByKey.get(labelPickerFor);
    if (index === undefined || index < listRange.start || index >= listRange.end) setLabelPickerFor(null);
  }, [labelPickerFor, indexByKey, listRange.start, listRange.end]);

  /** The label picker, open on the row being labelled. */
  const rowLabelPicker = (key: string, matchId: string, eventId: number) => (
    <LabelPickerPopover
      open
      onOpenChange={(open) => {
        if (!open) setLabelPickerFor(null);
      }}
      align="end"
      trigger={
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md bg-fill-2 text-foreground active:scale-95"
          title="Labels"
          aria-label="Labels"
        >
          <Tag className="size-3.5" />
        </button>
      }
      labels={labels}
      assignedAllIds={labelAssignments.get(key) ?? new Set<string>()}
      onToggle={(labelId, state) => labelHandlers.onToggleClip(matchId, eventId, labelId, state)}
      onCreate={labelHandlers.onCreate}
      onRename={labelHandlers.onRename}
      onRecolor={labelHandlers.onRecolor}
      onDelete={labelHandlers.onDelete}
      onSetKey={labelHandlers.onSetKey}
      onSeedDefaults={labelHandlers.onSeedDefaults}
    />
  );
  const canLabel = !!activeOrgId;

  const videoMissing =
    videoMatchId !== null &&
    videoStatusByMatch.get(videoMatchId) !== undefined &&
    videoStatusByMatch.get(videoMatchId) !== "ok";

  // The sheet's header, or the docked panel's: "Plays", the section it adds to, and its close button.
  const header = docked ? (
    <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-headline text-foreground">Plays</h2>
        {target && (
          <div className="-ml-1.5 flex min-w-0 items-center gap-0.5 text-callout text-muted-foreground">
            <span className="shrink-0 pl-1.5">Adding to</span>
            <PopUpButton
              size="sm"
              aria-label="Section to add to"
              value={target.value}
              onValueChange={target.onChange}
              options={target.options.map((o) => ({ value: o.id, label: o.label, description: o.hidden ? "Hidden from players" : undefined }))}
            />
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close Plays" onClick={onClose}>
        <X />
      </Button>
    </div>
  ) : (
    <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        <SheetTitle>{target ? `Add clips to ${target.name}` : "Add clips"}</SheetTitle>
        {target ? (
          // The section the clips go to, changed without closing the sheet.
          <SheetDescription asChild>
            <div className="-ml-1.5 flex min-w-0 items-center gap-0.5">
              <span className="pl-1.5">Adding to</span>
              <PopUpButton
                size="sm"
                aria-label="Section to add to"
                value={target.value}
                onValueChange={target.onChange}
                options={target.options.map((o) => ({
                  value: o.id,
                  label: o.label,
                  description: o.hidden ? "Hidden from players" : undefined,
                }))}
              />
            </div>
          </SheetDescription>
        ) : (
          <SheetDescription className="truncate">
            to <span className="font-medium text-foreground">{playlist.name}</span>
          </SheetDescription>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/upload">
            <Plus />
            Import game
          </Link>
        </Button>
        <SheetClose
          aria-label="Close"
          className="ml-1 flex size-7 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <X className="size-3.5" />
        </SheetClose>
      </div>
    </div>
  );
  // The list, and the selection's pill floating over its foot.
  const listPane = (
    <div className="relative flex h-full flex-col">
    {failedChosen.length > 0 && (
      <div className="flex shrink-0 items-center gap-3 border-b border-separator py-2 pr-3 pl-4">
        <div className="min-w-0 flex-1 text-callout text-muted-foreground">
          {failedChosen.map((m) => (
            <p key={m.id}>Couldn&apos;t load plays for {m.title}.</p>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => retryFailed(gameIds)}>
          Try again
        </Button>
      </div>
    )}
    {/* The count line every list of plays has (PlaysCountLine). */}
    <PlaysCountLine
      className="border-b border-separator px-4"
      count={filtered.length}
      total={allEvents.length}
      filtered={anyFilter}
      onClear={() => setFilters(EMPTY_PLAY_FILTERS)}
      // While filters narrow the list, its plays go in with one press (as the game view's Add all).
      trail={
        anyFilter &&
        filtered.length > 0 && (
          <Button variant="outline" size="xs" disabled={selectable === 0} onClick={() => addKeys(filteredKeys)}>
            {selectable === 0 ? <Check /> : <Plus />}
            {selectable === 0 ? "All added" : selectable === filtered.length ? `Add all ${selectable}` : `Add the other ${selectable}`}
          </Button>
        )
      }
      selection={{
        state: selectState,
        selected: selectedIds.size,
        selectable,
        onSelectAll: () => setSelectedIds(selectAll(filteredKeys, blockedSet)),
        onClear: () => setSelectedIds(new Set()),
        actions: (
          <>
            <BarAddButton count={selectedIds.size} targetName={targetLabel} onClick={handleAdd} />
            {activeOrgId && (
              <LabelPickerPopover
                trigger={<BarButton icon={<Tag />} label="Label" title="Label the selected plays" />}
                labels={labels}
                assignedAllIds={bulkAssignedAll}
                assignedSomeIds={bulkAssignedSome}
                onToggle={(labelId, state) => labelHandlers.onBulkToggle(selectedClipKeyPairs, labelId, state)}
                onCreate={labelHandlers.onCreate}
                onRename={labelHandlers.onRename}
                onRecolor={labelHandlers.onRecolor}
                onDelete={labelHandlers.onDelete}
                onSetKey={labelHandlers.onSetKey}
                onSeedDefaults={labelHandlers.onSeedDefaults}
              />
            )}
          </>
        ),
      }}
    />
    <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {filtered.length === 0 ? (
        eventsLoading ? (
          // This game's play-by-play is still arriving — without this
          // branch the filter-advice copy below would be plainly wrong.
          <div className="py-12 text-center text-sm text-muted-foreground">Loading plays…</div>
        ) : failedChosen.length > 0 ? null : (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {matches.length === 0
                ? "No games imported yet. Import a game to get started."
                : "No plays match these filters."}
            </p>
            {matches.length > 0 && anyFilter && (
              <Button size="sm" variant="outline" onClick={() => setFilters(EMPTY_PLAY_FILTERS)}>
                Clear filters
              </Button>
            )}
            {matches.length === 0 && (
              <Button asChild size="sm" variant="outline">
                <Link to="/upload">
                  <Plus />
                  Import game
                </Link>
              </Button>
            )}
          </div>
        )
      ) : (
        <ContextMenu onOpenChange={(open) => !open && setMenuKey(null)}>
        <ContextMenuTrigger asChild>
        <div
          role="grid"
          aria-label="Events"
          className={LIST_GROUP}
          // One menu for the list: the row right-clicked is what it acts on (with the selection, when it is in it).
          onContextMenu={(e) => {
            const key = (e.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
            if (!key) {
              e.preventDefault();
              return;
            }
            setMenuKey(key);
          }}
          {...listSelecting(selectedIds.size > 0)}
          aria-rowcount={filtered.length}
          // The rows not drawn, above and below: the list scrolls as if they were there.
          style={{ paddingTop: listRange.padTop, paddingBottom: listRange.padBottom }}
        >
          {filtered.slice(listRange.start, listRange.end).map(({ event, matchId, matchTitle }, i) => {
            const index = listRange.start + i;
            const key = `${matchId}:${event.eventId}`;
            return (
              <BrowserRow
                key={key}
                rowKey={key}
                index={index}
                event={event}
                matchId={matchId}
                matchTitle={matchTitle}
                showGame={isMultiMatch}
                isSelected={selectedIds.has(key)}
                slot={slotOf(key).status}
                slotWhere={slotOf(key).where}
                targetName={targetLabel}
                onRemove={onRowRemove}
                isActive={activeEventKey === key}
                assignedLabels={canLabel ? (labelsByKey.get(key) ?? NO_LABELS) : NO_LABELS}
                canLabel={canLabel}
                labelPicker={canLabel && labelPickerFor === key ? rowLabelPicker(key, matchId, event.eventId) : null}
                onAdd={onRowAdd}
                onPress={onRowPress}
                onLabel={onRowLabel}
                onDrag={docked ? onRowDrag : undefined}
              />
            );
          })}
        </div>
        </ContextMenuTrigger>
        {menuKey && rowMenu(menuKey)}
        </ContextMenu>
      )}
    </div>
    </div>
  );
  const playerPane = (
    <div className={docked ? "flex flex-col gap-2 p-3" : "flex h-full flex-col gap-3 overflow-y-auto p-4"}>
      {localVideoUrl ? (
        <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
        <div
          className={playerFs.active ? "relative min-h-0 flex-1" : cn("relative", docked && "mx-auto w-full")}
          // Docked: the picture as wide as the panel's height leaves room for, its controls and the Now bar in sight under it.
          // Never narrower than its controls need: a short panel scrolls instead.
          style={docked && !playerFs.active ? { maxWidth: DOCKED_STAGE_MAX_WIDTH, minWidth: "min(100%, 280px)" } : undefined}
        >
        <PlayerStage
          video={video}
          src={localVideoUrl}
          fileMissing={videoMissing}
          fullscreen={playerFs.active}
          onToggleFullscreen={toggleFullscreen}
          onExitFullscreen={() => void playerFs.exit()}
          title={activeEntry ? `${eventLabel(activeEntry.event)} · ${playerName(activeEntry.event)}` : undefined}
          clipWindow={clipWindow}
          position={activeIdx >= 0 ? { index: activeIdx, total: filtered.length } : null}
          onSeek={(t) => { video.currentTime = t; }}
          transport={{
            isQueueActive,
            canPrev,
            canNext,
            onPrev: handlePrev,
            onNext: handleNext,
            onReplay: handleReplay,
            onStop: handleStop,
            onPlayAll: handlePlayAll,
          }}
          speed={speed}
          onSpeedChange={setSpeed}
        >
          {videoMissing && (
            <div className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-2 bg-black/85 px-6 text-center">
              <VideoOff className="size-6 text-amber-400" />
              <p className="text-sm font-medium text-white">This game's video file can't be found</p>
              <p className="max-w-xs text-xs text-white/70">
                It may have been moved or renamed, or it's on another computer.
                Open the game and use Locate file to point at it.
              </p>
            </div>
          )}
        </PlayerStage>
        </div>
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-fill-1 px-6 text-center text-sm text-muted-foreground">
          Select a game with video to preview clips
        </div>
      )}
      {/* Under the player, the game view's Now bar: the play in words, its labels, Label (G) and Add (A). */}
      {activeEntry ? (
        <GameNowBar
          play={{ key: activeKeyOf(activeEntry), event: activeEntry.event, time: 0, start: 0, reach: "in" }}
          footage
          moment={null}
          score={null}
          breakScore={null}
          details={isMultiMatch ? [activeEntry.matchTitle] : []}
          labels={labelsByKey.get(activeKeyOf(activeEntry)) ?? NO_LABELS}
          collect={blockedSet.has(activeKeyOf(activeEntry)) ? "in" : "none"}
          targetName={targetLabel}
          inLabel={target ? `In ${slotOf(activeKeyOf(activeEntry)).status === "added" ? targetLabel : "report"}` : undefined}
          labelButton={(trigger) =>
            activeOrgId ? (
              <LabelPickerPopover
                open={nowLabelOpen}
                onOpenChange={setNowLabelOpen}
                trigger={trigger}
                side="top"
                align="end"
                labels={labels}
                assignedAllIds={labelAssignments.get(activeKeyOf(activeEntry)) ?? new Set()}
                onToggle={(labelId, state) => labelHandlers.onToggleClip(activeEntry.matchId, activeEntry.event.eventId, labelId, state)}
                onCreate={labelHandlers.onCreate}
                onRename={labelHandlers.onRename}
                onRecolor={labelHandlers.onRecolor}
                onDelete={labelHandlers.onDelete}
                onSetKey={labelHandlers.onSetKey}
                onSeedDefaults={labelHandlers.onSeedDefaults}
              />
            ) : null
          }
          lastLabel={null}
          onLabelAgain={() => {}}
          addRef={nowAddRef}
          onAdd={addFromKey}
          addCount={selectedIds.size}
          onSkip={null}
        />
      ) : (
        <p className="flex h-11 shrink-0 items-center px-1 text-callout text-muted-foreground">
          Choose a play to watch it. Plays run on to the next.
        </p>
      )}
    </div>
  );

  return (
    // Focusable, so a press on a row (which takes no focus itself) leaves the keyboard inside the panel, where its
    // keys are listened for, not on the sheet around it.
    <div ref={panelRef} tabIndex={-1} className="flex h-full flex-col overflow-hidden outline-none">
      {header}

      {/* Filters: the bar every list of plays has (PlaysFilterBar), its scope the games and the Leaders. */}
      <PlaysFilterBar
        className={cn("border-b border-separator pb-3", docked ? "px-4" : "px-5")}
        modal={!docked}
        filters={filters}
        onChange={(next) => (next.teams !== filters.teams ? handleTeamChange(new Set(next.teams), next) : setFilters(next))}
        scope={
          <div className="-ml-2 flex min-w-0 flex-wrap items-center gap-1">
            <GamePicker matches={matches} items={playlist.items} value={gameIds} onChange={handleGameChange} quickTeam={quickTeam} />
            <LeadersPopover events={leaderEvents} selectedPlayers={leaderSelected} onTogglePlayer={handleLeaderToggle} />
          </div>
        }
        presets={
          <>
            {activeOrgId && (
              <FilterPresetsMenu
                modal={!docked}
                presets={presets.presets}
                current={filters}
                onApply={applyPreset}
                onSave={(name) => presets.save(name, filters)}
                onRename={presets.rename}
                onDelete={presets.remove}
              />
            )}
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Clip length">
                      <Scissors />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Clip length: {preRoll} s before, {postRoll} s after
                </TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-64 space-y-3">
                <div>
                  <p className="text-headline">Clip length</p>
                  <p className="mt-0.5 text-callout text-muted-foreground">Seconds of footage before and after each play.</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Before</span>
                  <Stepper label="Pre-roll" value={preRoll} min={0} max={30} onChange={setPreRoll} format={(v) => `${v} s`} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">After</span>
                  <Stepper label="Post-roll" value={postRoll} min={0} max={60} onChange={setPostRoll} format={(v) => `${v} s`} />
                </div>
              </PopoverContent>
            </Popover>
          </>
        }
        players={playerGroups}
        labels={labels}
        periods={periods}
        moments={moments}
        teams={teams}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        searchRef={filterSearchRef}
      />

      {/* Content: the plays and the preview, side by side in the sheet; the preview under the list in the panel. */}
      {docked ? (
        // The list over the preview, the line between them dragged to give either more room.
        <ResizablePanelGroup direction="vertical" autoSaveId="report-plays-split" className="min-h-0 flex-1">
          <ResizablePanel id="plays" defaultSize="45" minSize="25">
            {listPane}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="player" defaultSize="55" minSize="25">
            {/* A size container: the docked stage is sized by its height (DOCKED_STAGE_MAX_WIDTH). */}
            <div className="h-full overflow-y-auto [container-type:size]">{playerPane}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <ResizablePanelGroup direction="horizontal" autoSaveId="add-clips" className="min-h-0 flex-1">
          <ResizablePanel id="plays" defaultSize="55" minSize="30">
            {listPane}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="player" defaultSize="45" minSize="25">
            {playerPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
});
