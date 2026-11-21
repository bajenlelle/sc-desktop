import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Plus, Scissors, Tag, VideoOff, X } from "lucide-react";
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
import { clickSelection, extendSelection, moveFocus, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { orderForAdd, playerTeam, startGames } from "@scoutable/shared/lib/add-clips-games";
import { applyPresetFilters, presetLabelsGone, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import {
  EMPTY_CLIP_FILTERS,
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  applyClipFiltersByKey,
  keepKnownChoices,
  playerKey,
  playersByTeam,
  teamsOf,
  type ClipFilters,
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
import { PLAY_ROW_HEIGHT, PlayRowCells, playRowClass, RowLabelButton, RowPlaylistSlot } from "@/components/plays/play-row";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import { FilterPresetsMenu } from "@/components/filter-presets-menu";
import { LeadersPopover } from "@/components/leaders-popover";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EventTypeChips } from "./event-type-chips";
import { GamePicker, type GamePickVia } from "./game-picker";
import { PlayerStage } from "./player-stage";
import { usePersistentVideo } from "./use-persistent-video";

// ---------------------------------------------------------------------------
// Filter vocabulary
// ---------------------------------------------------------------------------

// No Timeout chip: timeouts live in game marks, not in the play-by-play, so it would match nothing.
const BROWSER_TYPE_OPTIONS = EVENT_TYPE_OPTIONS.filter((o) => o.value !== "timeout");

// ---------------------------------------------------------------------------
// A row in the browser
// ---------------------------------------------------------------------------

/** Every row is this tall, so the list can draw only the rows near the view (lib/use-list-window.ts). */

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
  alreadyIn,
  isActive,
  assignedLabels,
  canLabel,
  labelPicker,
  onToggle,
  onPress,
  onLabel,
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
  alreadyIn: boolean;
  isActive: boolean;
  assignedLabels: Label[];
  /** Whether rows can be labelled at all (a space is active). */
  canLabel: boolean;
  /** The label picker, on the one row being labelled; null draws the plain Tag button. */
  labelPicker: React.ReactNode | null;
  /** The checkbox: a tick, or with Shift the range from the anchor. */
  onToggle: (rowKey: string, e: React.MouseEvent) => void;
  /** The row: plain plays it, ⌘ ticks it, Shift ticks the range. */
  onPress: (event: PlayByPlayEvent, matchId: string, e: React.MouseEvent) => void;
  /** The Tag button: opens the label picker on this row. */
  onLabel: (rowKey: string) => void;
}) {
  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-rowindex={index + 1}
      aria-selected={isSelected}
      aria-current={isActive ? "true" : undefined}
      onClick={(e) => onPress(event, matchId, e)}
      className={cn(
        // One height for every row, whatever it holds: the list is windowed by it (PLAY_ROW_HEIGHT).
        playRowClass({ selected: isActive }),
        "box-border",
        // The separator goes by place in the list: the first row drawn isn't always the list's first.
        index > 0 && "shadow-[inset_0_1px_0_var(--separator)]",
        !isActive && isSelected && "bg-fill-1 hover:bg-fill-2",
      )}
    >
      <PlayRowCells
        event={event}
        clock="with-period"
        now={isActive}
        strong={isActive}
        team={false}
        labels={assignedLabels}
        context={showGame ? matchTitle : undefined}
        lead={
          <div className="relative z-10 flex w-7 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* A play already in the playlist has its ✓ at the row's end instead: it can't be ticked again. */}
            {!alreadyIn && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                // No focus on press: a focused checkbox counts as a text field
                // for the sheet's keys, and they would stop after a tick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(rowKey, e);
                }}
                aria-label="Select"
                className="size-3.5 rounded accent-primary"
              />
            )}
          </div>
        }
        actions={
          <>
            {/* A plain button until it is pressed: the picker itself is mounted on one row at a time. */}
            {canLabel &&
              (labelPicker ?? <RowLabelButton title="Labels" aria-label="Labels" onClick={() => onLabel(rowKey)} />)}
            <RowPlaylistSlot status={alreadyIn ? "in" : "empty"} targetName="this playlist" />
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

/**
 * Add clips to the open playlist: every imported game's play-by-play,
 * filtered down, previewed on its own stage, ticked and added. Lives in a
 * sheet over the editor and owns the keys while it is open.
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
}: {
  /** The games to offer: read for their ids, titles, dates, teams and video, never their plays (the sheet reads those). */
  matches: StoredMatch[];
  matchLookup: Map<string, StoredMatch>;
  playlist: Playlist;
  /** The game to start on when the coach came here from it ("Build a playlist" on a game page). */
  preferredMatchId?: string | null;
  onAddClips: (clips: PlaylistClipItem[]) => void;
  activeOrgId: string | null;
  labels: Label[];
  /** The page's per-clip label sets, keyed `${matchId}:${eventId}`. */
  labelAssignments: Map<string, Set<string>>;
  labelHandlers: ClipBrowserLabelHandlers;
  /** Ask the page to load the labels on these games' clips if it hasn't yet. */
  onNeedLabels: (matchIds: string[]) => Promise<void>;
  /** Per-match video-file health from the page's probe (machine switches). */
  videoStatusByMatch: Map<string, VideoFileStatus>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [start] = useState(() => {
    const scope = getAddClipsScope(playlist.id);
    const s = startGames(matches, playlist.items, scope?.gameIds ?? [], preferredMatchId);
    return { ...s, teams: s.source === "remembered" ? (scope?.teams ?? []) : [] };
  });
  const [gameIds, setGameIds] = useState<string[]>(start.ids);
  // Once per opening: where it started, and that start is now the playlist's last games.
  useEffect(() => {
    trackEvent("clip_browser_opened", { start: start.source, games_in_playlist: new Set(playlist.items.filter(isClipItem).map((c) => c.matchId)).size });
    if (start.ids.length > 0 && start.source !== "remembered") setAddClipsScope(playlist.id, { gameIds: start.ids, teams: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, setFilters] = useState<ClipFilters>(EMPTY_CLIP_FILTERS);
  // One group's setter, for the dropdowns and chips.
  const setGroup = (group: keyof ClipFilters) => (next: ReadonlySet<string>) => {
    setFilters((f) => ({ ...f, [group]: next }));
  };

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

  const filtered = useMemo(
    () => applyClipFiltersByKey(allEvents, filters, (x) => labelAssignments.get(`${x.matchId}:${x.event.eventId}`)),
    [allEvents, filters, labelAssignments],
  );

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

  function handleTeamChange(newTeams: Set<string>) {
    pendingTeamsRef.current = null;
    if (gameIds.length > 0) setAddClipsScope(playlist.id, { gameIds, teams: [...newTeams] });
    const source = newTeams.size > 0
      ? allEvents.filter(({ event }) => newTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    const validPlayers = new Set(source.map((x) => playerKey(x.event)).filter((k): k is string => k !== null));
    setFilters((f) => ({ ...f, teams: newTeams, players: new Set([...f.players].filter((p) => validPlayers.has(p))) }));
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

  const allSelected = useMemo(
    () => filtered.length > 0 && filtered.every(({ event, matchId }) => selectedIds.has(`${matchId}:${event.eventId}`)),
    [filtered, selectedIds],
  );

  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(({ event, matchId }) => `${matchId}:${event.eventId}`)));
  }

  function toggleOne(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    for (const key of existingSet) keys.delete(key);
    return keys;
  }
  function applyClick(key: string, shift: boolean, toggle: boolean) {
    if (!shift && existingSet.has(key)) {
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
  function handleRowPress(event: PlayByPlayEvent, matchId: string, e: React.MouseEvent) {
    const key = `${matchId}:${event.eventId}`;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      applyClick(key, e.shiftKey, !e.shiftKey);
      return;
    }
    setAnchor(key);
    handleRowClick(event, matchId);
  }
  function handleRowToggle(key: string, e: React.MouseEvent) {
    if (!existingSet.has(key)) applyClick(key, e.shiftKey, !e.shiftKey);
  }
  // What the rows are handed: made once, calling the latest handlers, so a row's memo holds.
  const handleRowPressRef = useRef(handleRowPress);
  handleRowPressRef.current = handleRowPress;
  const handleRowToggleRef = useRef(handleRowToggle);
  handleRowToggleRef.current = handleRowToggle;
  const onRowPress = useCallback(
    (event: PlayByPlayEvent, matchId: string, e: React.MouseEvent) => handleRowPressRef.current(event, matchId, e),
    [],
  );
  const onRowToggle = useCallback((key: string, e: React.MouseEvent) => handleRowToggleRef.current(key, e), []);
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
  function handleAdd() {
    // Every game the sheet holds, not only the chosen ones: a tick stays across a change of games, and the
    // button counts it.
    const held = playsRef.current;
    const games = matches.filter((m) => held.has(m.id)).map((m) => ({ ...m, events: held.get(m.id)! }));
    const toAdd = orderForAdd([...selectedIds].filter((k) => !existingSet.has(k)), games);
    if (toAdd.length === 0) return;
    // The page says "5 clips added" with an Undo.
    onAddClips(toAdd);
    setSelectedIds(new Set());
  }
  const handleAddRef = useRef(handleAdd);
  handleAddRef.current = handleAdd;

  const newCount = Array.from(selectedIds).filter((k) => !existingSet.has(k)).length;
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
  // J/K/L shuttle, Space plays, R replays, F is full screen. Return ticks the
  // playing clip, ⌘A ticks every shown clip, ⌘↩ adds.
  useKeyScope("clip-browser", true, panelRef);
  useHotkeys("clip-browser", (e) => {
    const labelKey = labelKeySlot(e);
    if (labelKey !== null) {
      e.preventDefault();
      // A held key would put the label on and take it off again.
      if (!e.repeat) labelByKey(labelKey);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        handleAddRef.current();
        return;
      }
      const key = activeEventKeyRef.current;
      if (key && !existingSet.has(key)) toggleOne(key);
      if (key) setAnchor(key);
      return;
    }
    const action = resolvePlayerKey(e);
    if (action === "select-all") {
      e.preventDefault();
      setSelectedIds(new Set(filteredRef.current.map(({ event, matchId }) => `${matchId}:${event.eventId}`)));
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

  return (
    <div ref={panelRef} className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <SheetTitle>Add clips</SheetTitle>
          <SheetDescription className="truncate">
            to <span className="font-medium text-foreground">{playlist.name}</span>
          </SheetDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/upload">
              <Plus />
              Import game
            </Link>
          </Button>
          {activeOrgId && selectedClipKeyPairs.length > 0 && (
            <LabelPickerPopover
              trigger={
                <Button size="sm" variant="outline" title="Labels">
                  <Tag />
                  Apply label
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              }
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" onClick={handleAdd} disabled={newCount === 0}>
                  <Plus />
                  Add {newCount > 0 ? newCount : ""} clip{newCount !== 1 ? "s" : ""}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              {newCount === 0 ? "Tick clips to add them" : "Add to the playlist"}
              <Kbd>⌘↩</Kbd>
            </TooltipContent>
          </Tooltip>
          <SheetClose
            aria-label="Close"
            className="ml-1 flex size-7 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection"
          >
            <X className="size-3.5" />
          </SheetClose>
        </div>
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <GamePicker matches={matches} items={playlist.items} value={gameIds} onChange={handleGameChange} quickTeam={quickTeam} />
          <MultiSelectDropdown options={SHOT_TYPE_OPTIONS} selected={filters.shotTypes} onChange={setGroup("shotTypes")} placeholder="Shot type" />
          <MultiSelectDropdown options={SITUATION_OPTIONS} selected={filters.situations} onChange={setGroup("situations")} placeholder="Situation" />
          <MultiSelectDropdown
            options={teams.map((t) => ({ value: t, label: t }))}
            selected={filters.teams}
            onChange={handleTeamChange}
            placeholder="Team"
          />
          <MultiSelectDropdown
            groups={playerGroups.map((g) => ({
              label: g.teamName || "Other players",
              options: g.players.map((pl) => ({ value: pl.key, label: pl.number ? `#${pl.number} ${pl.name}` : pl.name, textValue: pl.name })),
            }))}
            selected={filters.players}
            onChange={setGroup("players")}
            placeholder="Player"
          />
          <LeadersPopover events={leaderEvents} selectedPlayers={leaderSelected} onTogglePlayer={handleLeaderToggle} />
          {labels.length > 0 && (
            <MultiSelectDropdown
              options={labels.map((l) => ({ value: l.id, label: l.name }))}
              selected={filters.labels ?? EMPTY_CLIP_FILTERS.labels!}
              onChange={setGroup("labels")}
              placeholder="Labels"
            />
          )}
          {activeOrgId && (
            <FilterPresetsMenu
              modal
              presets={presets.presets}
              current={filters}
              onApply={applyPreset}
              onSave={(name) => presets.save(name, filters)}
              onRename={presets.rename}
              onDelete={presets.remove}
            />
          )}
          <div className="ml-auto">
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
          </div>
        </div>
        <EventTypeChips options={BROWSER_TYPE_OPTIONS} selected={filters.types} onChange={setGroup("types")} />
      </div>

      {/* Content: events | preview */}
      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="55" minSize="30">
          <div className="flex h-full flex-col">
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
          <label className="flex h-8 shrink-0 cursor-default items-center gap-1.5 border-b border-separator pr-3 text-subheadline text-muted-foreground select-none">
            <span aria-hidden className="w-[3px]" />
            <span className="flex w-8 justify-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={filtered.length === 0}
                className="size-3.5 rounded accent-primary"
              />
            </span>
            Select all
            <span className="ml-auto nums">
              {filtered.length} event{filtered.length !== 1 ? "s" : ""}
            </span>
          </label>
          <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              eventsLoading ? (
                // This game's play-by-play is still arriving — without this
                // branch the filter-advice copy below would be plainly wrong.
                <div className="py-12 text-center text-sm text-muted-foreground">Loading clips…</div>
              ) : failedChosen.length > 0 ? null : (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {matches.length === 0
                      ? "No games imported yet. Import a game to get started."
                      : "No events match the current filters. Try adjusting them."}
                  </p>
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
              <div
                role="grid"
                aria-label="Events"
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
                      alreadyIn={existingSet.has(key)}
                      isActive={activeEventKey === key}
                      assignedLabels={canLabel ? (labelsByKey.get(key) ?? NO_LABELS) : NO_LABELS}
                      canLabel={canLabel}
                      labelPicker={canLabel && labelPickerFor === key ? rowLabelPicker(key, matchId, event.eventId) : null}
                      onToggle={onRowToggle}
                      onPress={onRowPress}
                      onLabel={onRowLabel}
                    />
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize="45" minSize="25">
          <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
            {localVideoUrl ? (
              <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
              <div className={playerFs.active ? "relative min-h-0 flex-1" : "relative"}>
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
                      Open the game in the Library and use Locate file to point at it.
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
            {activeEntry && (
              <div className="flex min-w-0 items-center gap-2 px-1 text-sm">
                <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", eventColors(activeEntry.event).badge)}>
                  {eventLabel(activeEntry.event)}
                </span>
                <span className="truncate font-medium">{playerName(activeEntry.event)}</span>
                <span className="shrink-0 text-subheadline nums text-muted-foreground">
                  Q{activeEntry.event.period} · {formatGameClock(activeEntry.event.gameClockTime)}
                </span>
                <span className="ml-auto shrink-0 text-subheadline nums text-muted-foreground">
                  {queueIdx + 1} of {queueRef.current.length || 1} queued
                </span>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
});
