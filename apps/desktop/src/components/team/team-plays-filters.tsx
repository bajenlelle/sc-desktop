import { ChevronDown, X } from "lucide-react";
import { EVENT_TYPE_OPTIONS, SHOT_TYPE_OPTIONS, SITUATION_OPTIONS, type ClipFilters, type PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import type { FilterPreset } from "@scoutable/shared/lib/filter-presets";
import type { Label } from "@scoutable/shared/types/labels";
import type { PlaysSide, TeamGame } from "@scoutable/shared/lib/team-video";
import { EventTypeChips } from "@/components/editor/event-type-chips";
import { FilterPresetsMenu } from "@/components/filter-presets-menu";
import { quietControl, quietState } from "@/components/ui/filter-button";
import { MultiSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { useFilterPresets } from "@/lib/use-filter-presets";
import { cn } from "@/lib/utils";
import { gameTitle } from "./team-play-list";

/** Timeouts aren't plays to watch: the list holds none. */
const TYPE_OPTIONS = EVENT_TYPE_OPTIONS.filter((o) => o.value !== "timeout");

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
 * Plays' controls: the side of the ball, the games, Add clips' filters and
 * presets, the picked plays as one pill, and the event chips.
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
}: {
  side: PlaysSide;
  onSide: (side: PlaysSide) => void;
  games: readonly TeamGame[];
  unticked: ReadonlySet<string>;
  onUntick: (next: Set<string>) => void;
  filters: ClipFilters;
  setFilters: (change: (f: ClipFilters) => ClipFilters) => void;
  playerGroups: readonly PlayerGroup[];
  labels: readonly Label[];
  presets: ReturnType<typeof useFilterPresets>;
  onApplyPreset: (p: FilterPreset) => void;
  pill: string | null;
  onClearPick: () => void;
}) {
  const group = (key: keyof ClipFilters) => (next: Set<string>) => setFilters((f) => ({ ...f, [key]: next }));
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
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
        <MultiSelectDropdown
          groups={playerGroups.map((g) => ({
            label: g.teamName || "Other players",
            options: g.players.map((p) => ({ value: p.key, label: p.number ? `#${p.number} ${p.name}` : p.name, textValue: p.name })),
          }))}
          selected={filters.players}
          onChange={group("players")}
          placeholder="Player"
        />
        <MultiSelectDropdown options={SHOT_TYPE_OPTIONS} selected={filters.shotTypes} onChange={group("shotTypes")} placeholder="Shot type" />
        <MultiSelectDropdown options={SITUATION_OPTIONS} selected={filters.situations} onChange={group("situations")} placeholder="Situation" />
        {labels.length > 0 && (
          <MultiSelectDropdown
            options={labels.map((l) => ({ value: l.id, label: l.name }))}
            selected={filters.labels ?? new Set()}
            onChange={group("labels")}
            placeholder="Labels"
          />
        )}
        <FilterPresetsMenu
          presets={presets.presets}
          current={filters}
          onApply={onApplyPreset}
          onSave={(name) => presets.save(name, filters)}
          onRename={presets.rename}
          onDelete={presets.remove}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {pill && (
          <span role="group" aria-label="Picked plays" className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-fill-3 pr-1 pl-2.5 text-subheadline font-semibold nums">
            {pill}
            <button
              type="button"
              aria-label="Clear the picked plays"
              onClick={onClearPick}
              className="flex size-4 items-center justify-center rounded-full outline-none hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        <EventTypeChips options={TYPE_OPTIONS} selected={filters.types} onChange={group("types")} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
