import * as React from "react";
import { Check, ListFilter, Plus } from "lucide-react";
import {
  EVENT_TYPE_OPTIONS,
  SHOT_TYPE_OPTIONS,
  SITUATION_OPTIONS,
  toggleFilter,
  type ClipFilters,
} from "@scoutable/shared/lib/clip-filters";
import { periodLabel } from "@scoutable/shared/lib/events";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_GAME_FILTERS, gameFilterCount, type GameFilters } from "@scoutable/shared/lib/game-list";
import type { Label } from "@scoutable/shared/types/labels";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The moments, in the order a coach asks for them. */
const MOMENTS: readonly { value: GameMoment; label: string }[] = [
  { value: "after_timeout", label: "After timeouts" },
  { value: "quarter_start", label: "Quarter starts" },
  { value: "quarter_end", label: "Quarter ends" },
  { value: "clutch", label: "Clutch" },
  { value: "run", label: "Runs" },
  { value: "fast_break", label: "Fast breaks" },
];

/** What a moment is, for its chip's tooltip. */
const MOMENT_HELP: Record<GameMoment, string> = {
  after_timeout: "The play each team timeout led to",
  quarter_start: "The first two minutes of every quarter",
  quarter_end: "The last two minutes of every quarter",
  clutch: "The last five minutes of the fourth quarter or overtime, within five points",
  run: "Every play inside a run of eight unanswered points or more",
  fast_break: "Plays the league marked as fast breaks",
};

export interface GamePerson {
  id: number;
  name: string;
  number: string | null;
  side: 1 | 2;
}

function Chip({
  pressed,
  disabled,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-40 disabled:active:scale-100",
        pressed ? "bg-selection text-selection-foreground" : "bg-card text-foreground ring-1 ring-separator hover:bg-fill-1 active:bg-fill-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-subheadline font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

/**
 * What the game's list shows, in three steps of depth. Always there: whose
 * plays (both teams or one) and the moments a coach asks a game about, one
 * at a time. One level down, in the filter sheet: a player search and the
 * Add clips vocabulary (event types, shot types, situations, quarters,
 * players, labels). And once anything narrows the list, a line that says how
 * many plays are left and offers to add them all.
 */
export function GameFilterBar({
  filters,
  onChange,
  teams,
  momentCounts,
  timeouts,
  periods,
  people,
  labels,
  visible,
  filtered,
  addable,
  targetName,
  onAddAll,
  searchRef,
  sheetOpen,
  onSheetOpenChange,
}: {
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  teams: { home: string; away: string };
  /** How many plays each moment has in this game. */
  momentCounts: Readonly<Record<GameMoment, number>>;
  /** Whether the game's timeouts are known: "ready", still being "read", or "none" on record. */
  timeouts: "ready" | "reading" | "none";
  periods: readonly number[];
  people: readonly GamePerson[];
  labels: readonly Label[];
  /** Plays listed now. */
  visible: number;
  filtered: boolean;
  /** Of the listed plays, how many aren't in the target yet. */
  addable: number;
  targetName: string | null;
  onAddAll: (anchor: HTMLElement) => void;
  searchRef: React.Ref<HTMLInputElement>;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
}) {
  const sheetCount = gameFilterCount(filters) + (filters.search.trim() ? 1 : 0);
  const setClip = (clip: ClipFilters) => onChange({ ...filters, clip });
  const togglePeriod = (period: number) => {
    const next = new Set(filters.periods);
    if (next.has(period)) next.delete(period);
    else next.add(period);
    onChange({ ...filters, periods: next });
  };
  const onePlayer = filters.clip.players.size === 1;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-3 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <SegmentedControl
          aria-label="Team"
          className="min-w-0 flex-1 [&>button]:min-w-0 [&>button]:flex-1 [&>button>span]:min-w-0"
          value={String(filters.team) as "0" | "1" | "2"}
          onValueChange={(v) => onChange({ ...filters, team: Number(v) as 0 | 1 | 2 })}
          options={[
            { value: "0", label: "Both" },
            { value: "1", label: <span className="truncate">{teams.home}</span>, title: teams.home },
            { value: "2", label: <span className="truncate">{teams.away}</span>, title: teams.away },
          ]}
        />
        <Popover open={sheetOpen} onOpenChange={onSheetOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={sheetCount > 0 ? `Filters, ${sheetCount} on` : "Filters"}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-selection",
                sheetCount > 0
                  ? "bg-selection text-selection-foreground"
                  : "bg-card text-foreground shadow-xs ring-1 ring-separator hover:bg-fill-1 data-[state=open]:bg-fill-2",
              )}
            >
              <ListFilter className="size-3.5" />
              Filter
              {sheetCount > 0 && <span className="nums">{sheetCount}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex max-h-[min(70vh,34rem)] w-80 flex-col gap-3 overflow-y-auto p-3">
            <SearchField
              ref={searchRef}
              placeholder="Player name or number"
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
            />
            <Group title="Plays">
              {EVENT_TYPE_OPTIONS.filter((o) => o.value !== "timeout").map((o) => (
                <Chip key={o.value} pressed={filters.clip.types.has(o.value)} onClick={() => setClip(toggleFilter(filters.clip, "types", o.value))}>
                  {o.label}
                </Chip>
              ))}
            </Group>
            <Group title="Shot">
              {SHOT_TYPE_OPTIONS.map((o) => (
                <Chip key={o.value} pressed={filters.clip.shotTypes.has(o.value)} onClick={() => setClip(toggleFilter(filters.clip, "shotTypes", o.value))}>
                  {o.label}
                </Chip>
              ))}
            </Group>
            <Group title="Situation">
              {SITUATION_OPTIONS.map((o) => (
                <Chip key={o.value} pressed={filters.clip.situations.has(o.value)} onClick={() => setClip(toggleFilter(filters.clip, "situations", o.value))}>
                  {o.label}
                </Chip>
              ))}
            </Group>
            {periods.length > 1 && (
              <Group title="Quarter">
                {periods.map((p) => (
                  <Chip key={p} pressed={filters.periods.has(p)} onClick={() => togglePeriod(p)}>
                    {periodLabel(p)}
                  </Chip>
                ))}
              </Group>
            )}
            {([1, 2] as const).map((side) => {
              const squad = people.filter((p) => p.side === side);
              if (squad.length === 0) return null;
              return (
                <Group key={side} title={side === 1 ? teams.home : teams.away}>
                  {squad.map((p) => (
                    <Chip key={p.id} pressed={filters.clip.players.has(p.name)} onClick={() => setClip(toggleFilter(filters.clip, "players", p.name))}>
                      {p.number ? <span className="nums opacity-70">#{p.number}</span> : null}
                      {p.name}
                    </Chip>
                  ))}
                </Group>
              );
            })}
            {onePlayer && (
              <label className="flex items-center justify-between gap-3 rounded-md bg-fill-1 px-2.5 py-2 text-callout">
                <span>
                  While on the floor
                  <span className="block text-subheadline text-muted-foreground">Every play while {[...filters.clip.players][0]} is in the game.</span>
                </span>
                <Switch checked={filters.onCourt} onCheckedChange={(on) => onChange({ ...filters, onCourt: on })} />
              </label>
            )}
            {labels.length > 0 && (
              <Group title="Labels">
                {labels.map((l) => (
                  <Chip key={l.id} pressed={!!filters.clip.labels?.has(l.id)} onClick={() => setClip(toggleFilter(filters.clip, "labels", l.id))}>
                    {l.name}
                  </Chip>
                ))}
              </Group>
            )}
            {sheetCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-muted-foreground"
                onClick={() => onChange({ ...EMPTY_GAME_FILTERS, team: filters.team, moment: filters.moment })}
              >
                Clear these filters
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div
        role="group"
        aria-label="Moment"
        style={{ scrollbarWidth: "none" }}
        className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 py-0.5 [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        <Chip pressed={filters.moment === null} onClick={() => onChange({ ...filters, moment: null })}>
          All plays
        </Chip>
        {MOMENTS.map((m) => {
          const pending = m.value === "after_timeout" && timeouts !== "ready";
          const none = momentCounts[m.value] === 0;
          const why = pending
            ? timeouts === "reading"
              ? "Reading the game's timeouts…"
              : "This game has no timeouts on record."
            : none
              ? "No plays like this in the game."
              : MOMENT_HELP[m.value];
          return (
            <Tooltip key={m.value}>
              <TooltipTrigger asChild>
                {/* The wrapper takes the hover, so a disabled chip still says why. */}
                <span className="shrink-0">
                  <Chip
                    pressed={filters.moment === m.value}
                    disabled={(pending || none) && filters.moment !== m.value}
                    onClick={() => onChange({ ...filters, moment: filters.moment === m.value ? null : m.value })}
                  >
                    {m.label}
                  </Chip>
                </span>
              </TooltipTrigger>
              <TooltipContent>{why}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {filtered && (
        <div className="flex h-7 items-center gap-2 text-subheadline">
          <span className="shrink-0 whitespace-nowrap nums text-muted-foreground">
            {visible} {visible === 1 ? "play" : "plays"}
          </span>
          <button
            type="button"
            className="shrink-0 rounded px-1 text-muted-foreground outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
            onClick={() => onChange(EMPTY_GAME_FILTERS)}
          >
            Clear
          </button>
          {visible > 0 && (
            <Button
              variant="outline"
              size="xs"
              className="ml-auto shrink-0"
              disabled={addable === 0}
              onClick={(e) => onAddAll(e.currentTarget)}
              title={addable === 0 ? `All ${visible} are in ${targetName ?? "the playlist"}` : undefined}
            >
              {addable === 0 ? <Check /> : <Plus />}
              {addable === 0 ? "All added" : addable === visible ? `Add all ${visible}` : `Add the other ${addable}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
