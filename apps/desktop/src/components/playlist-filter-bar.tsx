import * as React from "react";
import { Film, ListFilter } from "lucide-react";
import type { PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_PLAY_FILTERS, clearField, playFiltersCount, toggled, type PlayFilters } from "@scoutable/shared/lib/play-filters";
import type { Label } from "@scoutable/shared/types/labels";
import type { MenuField } from "@/components/plays/filter-menu";
import {
  ClearFiltersRow,
  FilterPopover,
  FilterToken,
  FilterTokens,
  PAGE_OF_FIELD,
  usePlayFilterFields,
} from "@/components/plays/plays-filter-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The playlist's filters (Johannes #4/#12): what every list of plays filters by, and which of its games. */
export interface QueueFilters extends PlayFilters {
  matchIds: ReadonlySet<string>;
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = { ...EMPTY_PLAY_FILTERS, matchIds: new Set() };

export function queueFiltersActive(f: QueueFilters): boolean {
  return queueFilterCount(f) > 0;
}

/** How many fields narrow the queue (the count on the toolbar's Filter). */
export function queueFilterCount(f: QueueFilters): number {
  return playFiltersCount(f) + (f.matchIds.size > 0 ? 1 : 0);
}

/**
 * The editor's filters. The editor has no filter bar: the toolbar's Filter is the menu's trigger (the Filter
 * menu every list of plays has, FilterMenu), as Linear's view header opens its filter menu in place. With no
 * event chips here, Event is a field of the menu, and Game one too when the playlist holds more than one. What
 * is on shows over the list as tokens, only while something is on; a token opens its field's page. Every field
 * only offers what the open playlist contains. Returns the toolbar's control and the tokens.
 */
export function usePlaylistFilters({
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
  /** The saved filters (FilterPresetsMenu), at the foot of the menu. */
  presets?: React.ReactNode;
}) {
  const [page, setPage] = React.useState<string | null>(null);
  const setPlay = (next: PlayFilters) => onChange({ ...next, matchIds: filters.matchIds });

  const gameTitle = (id: string) => games.find((g) => g.id === id)?.title ?? "Removed game";
  const gameField: MenuField[] =
    games.length > 1
      ? [
          {
            id: "games",
            name: "Game",
            icon: Film,
            values: games.map((g) => ({ value: g.id, label: g.title })),
            isOn: (v) => filters.matchIds.has(v),
            toggle: (v) => onChange({ ...filters, matchIds: toggled(filters.matchIds, v) }),
            clear: () => onChange({ ...filters, matchIds: new Set() }),
            count: filters.matchIds.size,
            summary: filters.matchIds.size === 1 ? gameTitle([...filters.matchIds][0]) : String(filters.matchIds.size),
          },
        ]
      : [];
  const { fields, tokens, menuCount } = usePlayFilterFields({
    filters,
    onChange: setPlay,
    players,
    labels,
    periods,
    moments,
    events: true,
    leadFields: gameField,
  });

  const openAt = (p: string | null) => {
    setPage(p);
    onOpenChange(true);
  };
  const clearAll = () => onChange({ ...EMPTY_QUEUE_FILTERS });

  const footer =
    presets || menuCount > 0 ? (
      <div className="flex items-center gap-1">
        {menuCount > 0 && (
          <div className="flex-1">
            <ClearFiltersRow onClear={clearAll} />
          </div>
        )}
        {presets && <div className={cn("flex", menuCount === 0 && "flex-1")}>{presets}</div>}
      </div>
    ) : undefined;

  /** The toolbar's Filter, as its other actions look: icon and word, the icon alone when the toolbar is compact. */
  const button = (compact: boolean): React.ReactElement => (
    <FilterPopover
      align="end"
      open={open}
      onOpenChange={onOpenChange}
      page={page}
      onPage={setPage}
      searchRef={searchRef}
      fields={fields}
      footer={footer}
      trigger={
        <Button
          variant="ghost"
          size={compact && menuCount === 0 ? "icon-sm" : "sm"}
          aria-label={menuCount > 0 ? `Filters, ${menuCount} on` : "Filters"}
          title="Filter (⌘F)"
          className={cn("data-[state=open]:bg-fill-2", menuCount > 0 && "bg-fill-2 hover:bg-fill-3")}
        >
          <ListFilter />
          {!compact && "Filter"}
          {menuCount > 0 && <span className="nums text-muted-foreground">{menuCount}</span>}
        </Button>
      }
    />
  );

  const gameToken =
    filters.matchIds.size > 0 ? (
      <FilterToken
        name="Game"
        op={filters.matchIds.size > 1 ? "is any of" : "is"}
        values={[...filters.matchIds].map(gameTitle).join(", ")}
        onEdit={() => openAt("games")}
        onRemove={() => onChange({ ...filters, matchIds: new Set() })}
      />
    ) : null;

  const tokenRow = (
    <FilterTokens
      tokens={tokens}
      picks={gameToken}
      onEdit={(field) => openAt(PAGE_OF_FIELD[field] ?? null)}
      onRemove={(field) => setPlay(clearField(filters, field))}
    />
  );

  return { button, tokens: tokenRow, count: menuCount };
}
