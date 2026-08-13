import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import type { Label } from "@scoutable/shared/types/labels";

export interface QueueFilters {
  players: Set<string>;
  labelIds: Set<string>;
  eventTypes: Set<string>;
  periods: Set<string>;
  matchIds: Set<string>;
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  players: new Set(),
  labelIds: new Set(),
  eventTypes: new Set(),
  periods: new Set(),
  matchIds: new Set(),
};

export function queueFiltersActive(f: QueueFilters): boolean {
  return (
    f.players.size > 0 ||
    f.labelIds.size > 0 ||
    f.eventTypes.size > 0 ||
    f.periods.size > 0 ||
    f.matchIds.size > 0
  );
}

/**
 * The in-playlist filter bar (Johannes #4/#12): narrow the queue by player,
 * label, event type, period or game. Every dropdown only offers what the
 * open playlist actually contains — an empty dimension isn't rendered.
 */
export function PlaylistFilterBar({
  filters,
  onChange,
  options,
  shownCount,
  totalCount,
}: {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  options: {
    players: string[];
    labels: Label[];
    eventTypes: { value: string; label: string }[];
    periods: string[];
    games: { id: string; title: string }[];
  };
  shownCount: number;
  totalCount: number;
}) {
  const set = <K extends keyof QueueFilters>(key: K, next: Set<string>) =>
    onChange({ ...filters, [key]: next });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
      {options.players.length > 1 && (
        <MultiSelectDropdown
          placeholder="Player"
          options={options.players.map((p) => ({ value: p, label: p }))}
          selected={filters.players}
          onChange={(s) => set("players", s)}
        />
      )}
      {options.labels.length > 0 && (
        <MultiSelectDropdown
          placeholder="Label"
          options={options.labels.map((l) => ({ value: l.id, label: l.name }))}
          selected={filters.labelIds}
          onChange={(s) => set("labelIds", s)}
        />
      )}
      {options.eventTypes.length > 1 && (
        <MultiSelectDropdown
          placeholder="Event type"
          options={options.eventTypes}
          selected={filters.eventTypes}
          onChange={(s) => set("eventTypes", s)}
        />
      )}
      {options.periods.length > 1 && (
        <MultiSelectDropdown
          placeholder="Period"
          options={options.periods.map((p) => ({ value: p, label: `Period ${p}` }))}
          selected={filters.periods}
          onChange={(s) => set("periods", s)}
        />
      )}
      {options.games.length > 1 && (
        <MultiSelectDropdown
          placeholder="Game"
          options={options.games.map((g) => ({ value: g.id, label: g.title }))}
          selected={filters.matchIds}
          onChange={(s) => set("matchIds", s)}
        />
      )}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {shownCount} of {totalCount} clips
      </span>
      {queueFiltersActive(filters) && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_QUEUE_FILTERS })}
          className="text-xs font-medium text-primary"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
