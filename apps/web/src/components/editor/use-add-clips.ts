"use client";

/**
 * The add-clips picker's state: which game is shown (only games with a
 * ready, synced cloud copy can be picked from; the others say why not),
 * the filters over its play-by-play (shared vocabulary in clip-filters.ts,
 * the bank's labels among them, as the desktop's clip browser filters), the
 * ticks (a macOS table's: ⌘ toggles, Shift ranges from the anchor, clips
 * already in the playlist are never ticked), and the preview's clip length,
 * which starts at the playlist's own.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyClipFilters,
  EMPTY_CLIP_FILTERS,
  hasActiveFilters,
  playersOf,
  teamsOf,
  type ClipFilters,
} from "@scoutable/shared/lib/clip-filters";
import { playlistRolls, rebaseOffsets, type RollPair } from "@scoutable/shared/lib/clip-timing";
import { isBookkeepingEvent } from "@scoutable/shared/lib/events";
import { clickSelection, extendSelection, moveFocus, type FocusMove } from "@scoutable/shared/lib/list-selection";
import { clampRolls, itemKey } from "@scoutable/shared/lib/playlist-edits";
import type { Label } from "@scoutable/shared/types/labels";
import { isClipItem, type PlayByPlayEvent, type Playlist, type PlaylistClipItem, type StoredMatch } from "@scoutable/shared/types/match";
import { useLabelAssignments } from "@/components/labels/use-labels";
import { trackEvent } from "@/lib/analytics";
import { formatGameDate } from "@/lib/format-game";
import type { EditorCloud } from "./use-playlist-editor";

/** One play the picker shows. */
export interface PickerEntry {
  /** `matchId:eventId`, the key a clip goes by in the playlist. */
  key: string;
  event: PlayByPlayEvent;
  matchId: string;
  matchTitle: string;
}

export interface GameOption {
  value: string;
  label: string;
  description: string;
  disabled: boolean;
}

/** Why a game can't be picked from, or null when it can. */
function gameReason(matchId: string, cloud: EditorCloud): string | null {
  if (cloud.syncByMatch.has(matchId)) return null;
  const video = cloud.videoByMatch.get(matchId);
  switch (video?.status) {
    case "uploading":
      return "Uploading the video…";
    case "converting":
      return "Converting the video…";
    case "failed":
      return "The video couldn't be converted";
    case "ready":
      return "Set the tip-off first";
    default:
      return cloud.loaded ? "No cloud copy" : "Loading…";
  }
}

const NO_LABELS: readonly Label[] = [];

export function useAddClips({
  playlist,
  matches,
  cloud,
  eventsLoaded,
  ensureEventsFor,
  initialMatchId,
  labels = NO_LABELS,
  labelOrgId = null,
}: {
  playlist: Playlist;
  matches: ReadonlyMap<string, StoredMatch>;
  cloud: EditorCloud;
  eventsLoaded: ReadonlySet<string>;
  ensureEventsFor: (matchIds: readonly string[]) => Promise<void>;
  /** The game to open on (`?add=<matchId>`), when it can be picked from. */
  initialMatchId: string | null;
  /** The space's labels, for the Labels filter. */
  labels?: readonly Label[];
  /** The space the labels belong to; without one there is no label filter. */
  labelOrgId?: string | null;
}) {
  // ---------------------------------------------------------------------------
  // The game
  // ---------------------------------------------------------------------------

  const gameOptions = useMemo<GameOption[]>(
    () =>
      [...matches.values()]
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .map((m) => {
          const reason = gameReason(m.id, cloud);
          return { value: m.id, label: m.title, description: reason ?? formatGameDate(m.date) ?? "", disabled: reason !== null };
        }),
    [matches, cloud],
  );
  const firstPickable = gameOptions.find((o) => !o.disabled)?.value ?? null;
  const [chosenMatchId, setChosenMatchId] = useState<string | null>(initialMatchId);
  // The chosen game while it can be picked from; else the first that can
  // (the copies may arrive after the panel opened).
  const matchId = chosenMatchId !== null && cloud.syncByMatch.has(chosenMatchId) ? chosenMatchId : firstPickable;
  const match = matchId ? (matches.get(matchId) ?? null) : null;
  const loading = matchId !== null && !eventsLoaded.has(matchId);

  // Asked again whenever the game's plays go missing (the editor reloaded
  // its playlist), not only when the game changes; ensureEventsFor dedupes.
  useEffect(() => {
    if (matchId && loading) void ensureEventsFor([matchId]);
  }, [matchId, loading, ensureEventsFor]);

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  /** Every watchable play of the shown game (dead-ball possession markers have nothing to watch). */
  const allEntries = useMemo<PickerEntry[]>(() => {
    if (!match) return [];
    return match.events.filter((e) => !isBookkeepingEvent(e)).map((event) => ({ key: `${match.id}:${event.eventId}`, event, matchId: match.id, matchTitle: match.title }));
  }, [match]);
  const allEvents = useMemo(() => allEntries.map((e) => e.event), [allEntries]);
  const teams = useMemo(() => teamsOf(allEvents), [allEvents]);
  /** Players, narrowed by the Team filter so the menu never offers one it would hide. */
  const playersByTeam = useCallback(
    (teamNames: ReadonlySet<string>) => new Set(playersOf(teamNames.size > 0 ? allEvents.filter((e) => teamNames.has(e.eventTeam?.teamName ?? "")) : allEvents)),
    [allEvents],
  );

  const [filters, setFiltersState] = useState<ClipFilters>(EMPTY_CLIP_FILTERS);
  const setFilter = useCallback(
    (group: keyof ClipFilters, next: Set<string>) => {
      setFiltersState((f) => {
        const out: ClipFilters = { ...f, [group]: next };
        // A team narrows the players on offer: players of other teams leave the filter.
        if (group === "teams" && next.size > 0) {
          const valid = playersByTeam(next);
          out.players = new Set([...f.players].filter((p) => valid.has(p)));
        }
        return out;
      });
      trackEvent("playlist_filtered", { origin: "web", group, count: next.size });
    },
    [playersByTeam],
  );
  const clearFilters = useCallback(() => setFiltersState(EMPTY_CLIP_FILTERS), []);
  const togglePlayer = useCallback(
    (name: string) => {
      const next = new Set(filters.players);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setFilter("players", next);
    },
    [filters.players, setFilter],
  );

  const players = useMemo(() => [...playersByTeam(filters.teams)], [playersByTeam, filters.teams]);
  /** The same Game + Team narrowing, for the Leaders popover. */
  const leaderEvents = useMemo(
    () => (filters.teams.size > 0 ? allEvents.filter((e) => filters.teams.has(e.eventTeam?.teamName ?? "")) : allEvents),
    [allEvents, filters.teams],
  );

  // The bank's labels on the shown game's plays (`playlist_id IS NULL`, the
  // desktop's clip browser), read as each game is shown.
  const clipKeys = useMemo(() => allEntries.map((e) => ({ matchId: e.matchId, eventId: e.event.eventId })), [allEntries]);
  const bank = useLabelAssignments({ orgId: labelOrgId, scope: null, clips: clipKeys, enabled: !!labelOrgId && labels.length > 0 });
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  /** A play's bank labels, in the vocabulary's order. */
  const labelsOf = useCallback(
    (key: string): Label[] => {
      const ids = bank.byClip.get(key);
      return ids ? labels.filter((l) => ids.has(l.id)) : [];
    },
    [bank.byClip, labels],
  );
  // A label deleted meanwhile filters nothing (its menu entry is gone too).
  const effectiveFilters = useMemo<ClipFilters>(
    () => (filters.labels && filters.labels.size > 0 ? { ...filters, labels: new Set([...filters.labels].filter((id) => labelById.has(id))) } : filters),
    [filters, labelById],
  );
  const filtered = useMemo(() => applyClipFilters(allEntries, effectiveFilters, (e) => bank.byClip.get(e.key)), [allEntries, effectiveFilters, bank.byClip]);
  const filtersActive = hasActiveFilters(effectiveFilters);

  // ---------------------------------------------------------------------------
  // Ticks
  // ---------------------------------------------------------------------------

  const existing = useMemo(() => new Set(playlist.items.filter(isClipItem).map(itemKey)), [playlist.items]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const focusRef = useRef<string | null>(null);
  const filteredRef = useRef(filtered);
  const selectedRef = useRef(selected);
  const existingRef = useRef(existing);
  useLayoutEffect(() => {
    filteredRef.current = filtered;
    selectedRef.current = selected;
    existingRef.current = existing;
  });

  const orderOf = useCallback(() => filteredRef.current.map((e) => e.key), []);
  const withoutExisting = useCallback((keys: Set<string>) => {
    for (const key of existingRef.current) keys.delete(key);
    return keys;
  }, []);

  const setAnchor = useCallback((key: string | null) => {
    anchorRef.current = key;
    focusRef.current = key;
  }, []);

  /** A plain or ⌘ click, or a tick: the row (toggled with ⌘ or the checkbox); Shift ranges from the anchor. */
  const applyClick = useCallback(
    (key: string, shift: boolean, toggle: boolean) => {
      if (!shift && existingRef.current.has(key)) {
        setAnchor(key);
        return;
      }
      const next = clickSelection({ order: orderOf(), selected: selectedRef.current, anchor: anchorRef.current, focus: focusRef.current, key, shift, toggle });
      setSelected(withoutExisting(next.selected));
      anchorRef.current = next.anchor;
      focusRef.current = next.focus;
    },
    [orderOf, withoutExisting, setAnchor],
  );

  const toggleOne = useCallback(
    (key: string) => {
      if (existingRef.current.has(key)) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  /** Shift+arrows: tick from the anchor to the row there; answers that row for the caller to play. */
  const extendTicks = useCallback(
    (move: FocusMove, activeKey: string | null): string | null => {
      const order = orderOf();
      const from = focusRef.current ?? activeKey;
      const to = moveFocus(order, from, move);
      if (to === null) return null;
      const shown = (key: string | null): key is string => key !== null && order.includes(key);
      const anchor = shown(anchorRef.current) ? anchorRef.current : shown(from) ? from : to;
      setSelected((prev) => withoutExisting(extendSelection({ order, selected: prev, anchor, previousFocus: shown(from) ? from : null, focus: to })));
      anchorRef.current = anchor;
      focusRef.current = to;
      return to;
    },
    [orderOf, withoutExisting],
  );

  /** ↑/↓, Home/End, ⌘↑/⌘↓: the row there (the caller plays it). */
  const walk = useCallback(
    (move: FocusMove, activeKey: string | null): string | null => {
      const to = moveFocus(orderOf(), activeKey, move);
      if (to !== null) setAnchor(to);
      return to;
    },
    [orderOf, setAnchor],
  );

  const allShownSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.key) || existing.has(e.key));
  const selectAllShown = useCallback(() => {
    setSelected(withoutExisting(new Set(filteredRef.current.map((e) => e.key))));
  }, [withoutExisting]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const toggleSelectAll = useCallback(() => {
    if (allShownSelected) clearSelection();
    else selectAllShown();
  }, [allShownSelected, clearSelection, selectAllShown]);

  const setGame = useCallback(
    (id: string) => {
      setChosenMatchId(id);
      // Teams and players belong to a game; ticks do too.
      setFiltersState((f) => ({ ...f, teams: new Set(), players: new Set() }));
      setSelected(new Set());
      setAnchor(null);
    },
    [setAnchor],
  );

  // ---------------------------------------------------------------------------
  // The preview's clip length, and what gets added
  // ---------------------------------------------------------------------------

  const playlistPair = useMemo(() => playlistRolls(playlist), [playlist]);
  const [pair, setPairState] = useState<RollPair>(playlistPair);
  const setPair = useCallback((next: Partial<RollPair>) => {
    setPairState((p) => clampRolls(next.pre ?? p.pre, next.post ?? p.post));
  }, []);

  const newCount = useMemo(() => [...selected].filter((k) => !existing.has(k)).length, [selected, existing]);

  /** The ticked plays as playlist clips, their preview length kept as offsets on the playlist's pair. */
  const buildClips = useCallback((): PlaylistClipItem[] => {
    const out: PlaylistClipItem[] = [];
    for (const entry of filteredRef.current) {
      if (!selectedRef.current.has(entry.key) || existingRef.current.has(entry.key)) continue;
      const o = rebaseOffsets({}, pair, playlistPair);
      out.push({
        type: "clip",
        matchId: entry.matchId,
        eventId: entry.event.eventId,
        ...(o.preRollOffset !== 0 ? { preRollOffset: o.preRollOffset } : {}),
        ...(o.postRollOffset !== 0 ? { postRollOffset: o.postRollOffset } : {}),
      });
    }
    return out;
  }, [pair, playlistPair]);

  return {
    gameOptions,
    matchId,
    match,
    loading,
    setGame,
    filters,
    setFilter,
    clearFilters,
    togglePlayer,
    filtersActive,
    teams,
    players,
    leaderEvents,
    labels,
    labelsOf,
    allCount: allEntries.length,
    filtered,
    existing,
    selected,
    applyClick,
    toggleOne,
    extendTicks,
    walk,
    setAnchor,
    allShownSelected,
    toggleSelectAll,
    selectAllShown,
    clearSelection,
    pair,
    setPair,
    newCount,
    buildClips,
  };
}

export type AddClipsPicker = ReturnType<typeof useAddClips>;
