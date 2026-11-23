import type * as React from "react";
import type { PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_PLAY_FILTERS, playFiltersCount, type PlayFilters } from "@scoutable/shared/lib/play-filters";
import type { Label } from "@scoutable/shared/types/labels";
import { PlaysFilterBar } from "@/components/plays/plays-filter-bar";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";

/** The playlist's filters (Johannes #4/#12): what every list of plays filters by, and which of its games. */
export interface QueueFilters extends PlayFilters {
  matchIds: ReadonlySet<string>;
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = { ...EMPTY_PLAY_FILTERS, matchIds: new Set() };

export function queueFiltersActive(f: QueueFilters): boolean {
  return queueFilterCount(f) > 0;
}

/** How many fields narrow the queue (the badge on the toolbar's Filter). */
export function queueFilterCount(f: QueueFilters): number {
  return playFiltersCount(f) + (f.matchIds.size > 0 ? 1 : 0);
}

/**
 * The in-playlist filter bar: the bar every list of plays has (PlaysFilterBar), its scope the playlist's games
 * when it has more than one. Every section only offers what the open playlist contains.
 */
export function PlaylistFilterBar({
  filters,
  onChange,
  games,
  players,
  labels,
  periods,
  moments,
  open,
  onOpenChange,
  searchRef,
  presets,
}: {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  games: readonly { id: string; title: string }[];
  players: readonly PlayerGroup[];
  labels: readonly Label[];
  periods: readonly number[];
  moments: { counts: Partial<Record<GameMoment, number>>; why?: Partial<Record<GameMoment, string>> };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRef?: React.Ref<HTMLInputElement>;
  presets?: React.ReactNode;
}) {
  return (
    <PlaysFilterBar
      filters={filters}
      onChange={(next) => onChange({ ...next, matchIds: filters.matchIds })}
      scope={
        games.length > 1 ? (
          <MultiSelectDropdown
            placeholder="Game"
            options={games.map((g) => ({ value: g.id, label: g.title }))}
            selected={filters.matchIds}
            onChange={(s) => onChange({ ...filters, matchIds: s })}
          />
        ) : undefined
      }
      presets={presets}
      players={players}
      labels={labels}
      periods={periods}
      moments={moments}
      open={open}
      onOpenChange={onOpenChange}
      searchRef={searchRef}
    />
  );
}
