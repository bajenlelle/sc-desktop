import * as React from "react";
import { ListFilter, X } from "lucide-react";
import { EVENT_TYPE_OPTIONS, SHOT_TYPE_OPTIONS, SITUATION_OPTIONS, type PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import { periodLabel } from "@scoutable/shared/lib/events";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import {
  EMPTY_PLAY_FILTERS,
  MOMENT_OPTIONS,
  appliedFilters,
  clearField,
  playFiltersCount,
  toggled,
  type AppliedFilter,
  type PlayFilters,
} from "@scoutable/shared/lib/play-filters";
import type { Label } from "@scoutable/shared/types/labels";
import { EventTypeChips } from "@/components/editor/event-type-chips";
import { Button } from "@/components/ui/button";
import { quietControl, quietState } from "@/components/ui/filter-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The event chips every list offers: the Add clips set without Timeout (a game mark, not a play). */
export const PLAY_EVENT_OPTIONS = EVENT_TYPE_OPTIONS.filter((o) => o.value !== "timeout");

/** One value in a section: pressed while it filters. */
export function FilterChip({
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
        pressed ? "bg-fill-3 text-foreground hover:bg-fill-4" : "bg-fill-1 text-foreground hover:bg-fill-2 active:bg-fill-3",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A section of the Filter popover: its name, then its chips. */
export function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <h3 className="text-subheadline font-medium text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

/**
 * A filter that is on, as Linear draws one: what it filters, how, the values, and × to take it off. A press on
 * the values opens the Filter popover, where they are changed. Also the look of a pick from Stats or Season
 * (no `op`).
 */
export function FilterToken({
  name,
  op,
  values,
  onEdit,
  onRemove,
  removeLabel,
  groupLabel,
}: {
  /** What it filters; empty for a pick that names itself ("Threes · 4 of 9"). */
  name: string;
  op?: string;
  values: string;
  onEdit?: () => void;
  onRemove: () => void;
  removeLabel?: string;
  groupLabel?: string;
}) {
  const segment = "flex h-full items-center px-2";
  const first = !name;
  return (
    <span
      role="group"
      aria-label={groupLabel ?? `${name} filter`}
      className="flex h-6 max-w-full min-w-0 items-center overflow-hidden rounded-md bg-fill-1 text-xs nums"
    >
      {name && <span className={cn(segment, "shrink-0 text-muted-foreground")}>{name}</span>}
      {op && <span className={cn(segment, "shrink-0 border-l border-background px-1.5 text-muted-foreground")}>{op}</span>}
      {onEdit ? (
        <button
          type="button"
          title={values}
          onClick={onEdit}
          className={cn(segment, "min-w-0 font-medium outline-none transition-colors duration-100 hover:bg-fill-2 focus-visible:bg-fill-2", !first && "border-l border-background")}
        >
          <span className="truncate">{values}</span>
        </button>
      ) : (
        <span title={values} className={cn(segment, "min-w-0 font-medium", !first && "border-l border-background")}>
          <span className="truncate">{values}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={removeLabel ?? `Remove ${name} filter`}
        onClick={onRemove}
        className="flex h-full w-6 shrink-0 items-center justify-center border-l border-background text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:bg-fill-2"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

const matchesQuery = (query: string, ...texts: (string | null | undefined)[]) =>
  query === "" || texts.some((t) => !!t && t.toLowerCase().includes(query));

/**
 * The filters over every list of plays (the game view, Teams' Plays, Add clips, the editor), as Linear keeps
 * them: a row with the list's scope (whose plays, which games), Filter and Presets; the event chips, one press
 * away; and, while anything else is on, a token per filter that says what it is and takes it off. Everything
 * but the events lives in the one Filter popover, its search narrowing the choices ("#7", "Berg", "clutch").
 * A section shows only where its choices exist: quarters with more than one, moments where the list has them,
 * teams where `teams` is given.
 */
export function PlaysFilterBar({
  filters,
  onChange,
  scope,
  presets,
  players,
  labels,
  periods = [],
  moments = null,
  teams,
  playerExtra,
  open,
  onOpenChange,
  searchRef,
  picks,
  onClearAll,
  modal = false,
  className,
}: {
  filters: PlayFilters;
  onChange: (next: PlayFilters) => void;
  /** Row 1's start: whose plays (a switch) and which games. */
  scope?: React.ReactNode;
  /** The saved filters (FilterPresetsMenu), at row 1's end. */
  presets?: React.ReactNode;
  players: readonly PlayerGroup[];
  labels: readonly Label[];
  periods?: readonly number[];
  /** The moments the list's plays have; why a moment is off (no timeouts on record), by moment. Null: no moments. */
  moments?: { counts: Partial<Record<GameMoment, number>>; why?: Partial<Record<GameMoment, string>> } | null;
  /** Team names, for a Team section (Add clips, whose games are any teams'). */
  teams?: readonly string[];
  /** Under the players: the game view's "While on the floor". */
  playerExtra?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRef?: React.Ref<HTMLInputElement>;
  /** Picks that aren't filters (the plays behind a number in Stats, a Season key), drawn as tokens first. */
  picks?: React.ReactNode;
  /** The popover's "Clear these filters": what the view clears (its scope stays). Defaults to every field. */
  onClearAll?: () => void;
  /** Inside a sheet (Add clips): the popover takes the focus trap over, as the sheet's other menus do. */
  modal?: boolean;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase().replace(/^#/, "");
  const count = playFiltersCount(filters);
  const set = <K extends keyof PlayFilters>(key: K, value: PlayFilters[K]) => onChange({ ...filters, [key]: value });
  const toggle = (key: "types" | "shotTypes" | "situations" | "teams" | "players" | "labels", value: string) =>
    set(key, toggled(filters[key] ?? new Set<string>(), value));

  const playerName = React.useMemo(() => {
    const byKey = new Map<string, string>();
    for (const g of players) for (const p of g.players) byKey.set(p.key, p.number ? `#${p.number} ${p.name}` : p.name);
    return (key: string) => byKey.get(key) ?? (key.startsWith("name:") ? key.slice(5) : key);
  }, [players]);
  const labelName = React.useMemo(() => {
    const byId = new Map(labels.map((l) => [l.id, l.name]));
    return (id: string) => byId.get(id) ?? "Removed label";
  }, [labels]);
  // The events have their chips, always in view: a token for them would say it twice.
  const tokens = appliedFilters(filters, { player: playerName, label: labelName }).filter((t) => t.field !== "types");

  const sections: React.ReactNode[] = [];
  const optionChips = (key: "shotTypes" | "situations", options: readonly { value: string; label: string }[]) =>
    options
      .filter((o) => matchesQuery(q, o.label))
      .map((o) => (
        <FilterChip key={o.value} pressed={filters[key].has(o.value)} onClick={() => toggle(key, o.value)}>
          {o.label}
        </FilterChip>
      ));
  for (const g of players) {
    const shown = g.players.filter((p) => matchesQuery(q, p.name, p.number));
    if (shown.length === 0) continue;
    sections.push(
      <FilterSection key={`players:${g.teamName}`} title={g.teamName || "Players"}>
        {shown.map((p) => (
          <FilterChip key={p.key} pressed={filters.players.has(p.key)} onClick={() => toggle("players", p.key)}>
            {p.number ? <span className="nums opacity-70">#{p.number}</span> : null}
            {p.name}
          </FilterChip>
        ))}
      </FilterSection>,
    );
  }
  if (playerExtra && q === "") sections.push(<React.Fragment key="player-extra">{playerExtra}</React.Fragment>);
  const shots = optionChips("shotTypes", SHOT_TYPE_OPTIONS);
  if (shots.length > 0) sections.push(<FilterSection key="shot" title="Shot type">{shots}</FilterSection>);
  const situations = optionChips("situations", SITUATION_OPTIONS);
  if (situations.length > 0) sections.push(<FilterSection key="situation" title="Situation">{situations}</FilterSection>);
  const quarterChips = periods.length > 1 ? periods.filter((p) => matchesQuery(q, periodLabel(p))) : [];
  const momentChips = moments ? MOMENT_OPTIONS.filter((m) => matchesQuery(q, m.label)) : [];
  if (quarterChips.length > 0 || momentChips.length > 0) {
    sections.push(
      <FilterSection key="when" title="When">
        {quarterChips.map((p) => (
          <FilterChip key={p} pressed={filters.periods.has(p)} onClick={() => set("periods", toggled(filters.periods, p))}>
            {periodLabel(p)}
          </FilterChip>
        ))}
        {momentChips.map((m) => {
          const why = moments?.why?.[m.value] ?? (moments?.counts[m.value] === 0 ? "No plays like this here." : null);
          const on = filters.moment === m.value;
          return (
            <Tooltip key={m.value}>
              <TooltipTrigger asChild>
                {/* The wrapper takes the hover, so a chip that is off still says why. */}
                <span className="shrink-0">
                  <FilterChip pressed={on} disabled={!!why && !on} onClick={() => set("moment", on ? null : m.value)}>
                    {m.label}
                  </FilterChip>
                </span>
              </TooltipTrigger>
              <TooltipContent>{why ?? m.help}</TooltipContent>
            </Tooltip>
          );
        })}
      </FilterSection>,
    );
  }
  if (teams && teams.length > 1) {
    const shown = teams.filter((t) => matchesQuery(q, t));
    if (shown.length > 0)
      sections.push(
        <FilterSection key="teams" title="Team">
          {shown.map((t) => (
            <FilterChip key={t} pressed={filters.teams.has(t)} onClick={() => toggle("teams", t)}>
              {t}
            </FilterChip>
          ))}
        </FilterSection>,
      );
  }
  const labelChips = labels.filter((l) => matchesQuery(q, l.name));
  if (labelChips.length > 0)
    sections.push(
      <FilterSection key="labels" title="Labels">
        {labelChips.map((l) => (
          <FilterChip key={l.id} pressed={!!filters.labels?.has(l.id)} onClick={() => toggle("labels", l.id)}>
            {l.name}
          </FilterChip>
        ))}
      </FilterSection>,
    );

  const clearPopover = onClearAll ?? (() => onChange({ ...EMPTY_PLAY_FILTERS, types: filters.types }));
  const popoverCount = count - (filters.types.size > 0 ? 1 : 0);

  return (
    <div className={cn("flex shrink-0 flex-col gap-2", className)}>
      {/* In a narrow list column the scope wraps onto a second line rather than squeeze; Filter and Presets stay
          on the first, beside its first control (top-aligned, not centred between the two lines). */}
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        {scope && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{scope}</div>}
        <div className={cn("flex shrink-0 items-center gap-1", !scope && "flex-1")}>
          <Popover
            modal={modal}
            open={open}
            onOpenChange={(o) => {
              if (!o) setQuery("");
              onOpenChange(o);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={popoverCount > 0 ? `Filters, ${popoverCount} on` : "Filters"}
                title="Filter (⌘F)"
                className={cn(quietControl, quietState(popoverCount > 0), "text-xs font-medium [&_svg]:size-3.5")}
              >
                <ListFilter className="size-3.5" />
                Filter
                {popoverCount > 0 && <span className="nums">{popoverCount}</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex max-h-[min(70vh,34rem)] w-80 flex-col gap-3 overflow-y-auto p-3">
              <SearchField
                ref={searchRef}
                placeholder="Player name or number"
                aria-label="Search filters"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {sections.length > 0 ? sections : <p className="py-2 text-center text-callout text-muted-foreground">No filters match “{query.trim()}”.</p>}
              {popoverCount > 0 && (
                <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={clearPopover}>
                  Clear these filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
          {presets}
        </div>
      </div>
      <EventTypeChips options={PLAY_EVENT_OPTIONS} selected={filters.types} onChange={(next) => set("types", next)} />
      {(tokens.length > 0 || picks) && (
        <div role="group" aria-label="Filters on" className="flex min-w-0 flex-wrap items-center gap-1.5">
          {picks}
          {tokens.map((t: AppliedFilter) => (
            <FilterToken
              key={t.field}
              name={t.name}
              op={t.op}
              values={t.values.join(", ")}
              onEdit={() => onOpenChange(true)}
              onRemove={() => onChange(clearField(filters, t.field))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
