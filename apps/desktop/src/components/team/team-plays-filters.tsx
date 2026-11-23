import type * as React from "react";
import { ChevronDown } from "lucide-react";
import type { PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import type { PlayFilters } from "@scoutable/shared/lib/play-filters";
import type { FilterPreset } from "@scoutable/shared/lib/filter-presets";
import type { Label } from "@scoutable/shared/types/labels";
import type { PlaysSide, TeamGame } from "@scoutable/shared/lib/team-video";
import { FilterPresetsMenu } from "@/components/filter-presets-menu";
import { FilterToken, PlaysFilterBar } from "@/components/plays/plays-filter-bar";
import { quietControl, quietState } from "@/components/ui/filter-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { useFilterPresets } from "@/lib/use-filter-presets";
import { cn } from "@/lib/utils";
import { gameTitle } from "./team-play-list";

/** Which of the team's games the list holds: all ticked to start, any can be unticked; no limit (Add clips stops at 10). */
function GamesPicker({ games, unticked, onChange }: { games: readonly TeamGame[]; unticked: ReadonlySet<string>; onChange: (next: Set<string>) => void }) {
  const ticked = games.filter((g) => !unticked.has(g.gameId)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(quietControl, quietState(ticked < games.length))}>
          <span>Games</span>
          <span className="nums text-foreground">
            {ticked} of {games.length}
          </span>
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto p-1">
        <ul aria-label="Games">
          {games.map((g) => (
            <li key={g.gameId}>
              <label className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fill-1">
                <input
                  type="checkbox"
                  className="size-3.5 rounded accent-primary"
                  checked={!unticked.has(g.gameId)}
                  // The last ticked game stays: an empty list would read as none of their games.
                  disabled={!unticked.has(g.gameId) && ticked === 1}
                  onChange={() => {
                    const next = new Set(unticked);
                    if (next.has(g.gameId)) next.delete(g.gameId);
                    else next.add(g.gameId);
                    onChange(next);
                  }}
                />
                <span className="truncate">{gameTitle(g)}</span>
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Plays' controls, in the bar every list of plays has (PlaysFilterBar): the side of the ball and the games,
 * Filter (players, shot types, situations, quarters and moments, labels; ⌘F) and Presets; the event chips; the
 * picked plays and every filter that is on as tokens.
 */
export function TeamPlaysFilters({
  side,
  onSide,
  games,
  unticked,
  onUntick,
  filters,
  setFilters,
  playerGroups,
  labels,
  presets,
  onApplyPreset,
  pill,
  onClearPick,
  periods,
  moments,
  open,
  onOpenChange,
  searchRef,
}: {
  side: PlaysSide;
  onSide: (side: PlaysSide) => void;
  games: readonly TeamGame[];
  unticked: ReadonlySet<string>;
  onUntick: (next: Set<string>) => void;
  filters: PlayFilters;
  setFilters: (change: (f: PlayFilters) => PlayFilters) => void;
  playerGroups: readonly PlayerGroup[];
  labels: readonly Label[];
  presets: ReturnType<typeof useFilterPresets>;
  onApplyPreset: (p: FilterPreset) => void;
  pill: string | null;
  onClearPick: () => void;
  periods: readonly number[];
  moments: { counts: Partial<Record<GameMoment, number>>; why?: Partial<Record<GameMoment, string>> };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <PlaysFilterBar
      className="border-b border-separator px-4 py-2.5"
      filters={filters}
      onChange={(next) => setFilters(() => next)}
      scope={
        <>
          <SegmentedControl
            size="sm"
            aria-label="Side of the ball"
            value={side}
            onValueChange={onSide}
            options={[
              { value: "with", label: "With the ball", title: "Their plays" },
              { value: "without", label: "Without the ball", title: "What their opponents did against them" },
            ]}
          />
          <GamesPicker games={games} unticked={unticked} onChange={onUntick} />
        </>
      }
      presets={
        <FilterPresetsMenu
          presets={presets.presets}
          current={filters}
          onApply={onApplyPreset}
          onSave={(name) => presets.save(name, filters)}
          onRename={presets.rename}
          onDelete={presets.remove}
        />
      }
      players={playerGroups}
      labels={labels}
      periods={periods}
      moments={moments}
      open={open}
      onOpenChange={onOpenChange}
      searchRef={searchRef}
      picks={
        pill && <FilterToken name="" values={pill} groupLabel="Picked plays" removeLabel="Clear the picked plays" onRemove={onClearPick} />
      }
    />
  );
}
