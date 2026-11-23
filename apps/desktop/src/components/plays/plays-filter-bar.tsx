import * as React from "react";
import { Clock, Crosshair, ListFilter, Shield, Tag, User, X, Zap } from "lucide-react";
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
  type PlayFilterField,
  type PlayFilters,
} from "@scoutable/shared/lib/play-filters";
import type { Label } from "@scoutable/shared/types/labels";
import { EventTypeChips } from "@/components/editor/event-type-chips";
import { quietControl, quietState } from "@/components/ui/filter-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterMenu, type MenuField } from "./filter-menu";
import { cn } from "@/lib/utils";

/** The event chips every list offers: the Add clips set without Timeout (a game mark, not a play). */
export const PLAY_EVENT_OPTIONS = EVENT_TYPE_OPTIONS.filter((o) => o.value !== "timeout");

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


/**
 * The filters over every list of plays (the game view, Teams' Plays, Add clips, the editor), as Linear keeps
 * them: a row with the list's scope (whose plays, which games), Filter and Presets; the event chips, one press
 * away; and, while anything else is on, a token per filter that says what it is and takes it off. Everything
 * but the events lives in the Filter menu (FilterMenu): its fields first, each opening a page of values with
 * checkmarks, and one search that finds values across every field ("#7", "Berg", "clutch"). A token opens its
 * field's page. A field is listed only where its values exist: quarters with more than one, moments where the
 * list has them, teams where `teams` is given.
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
  // The Filter menu's open page: a field's values, or null for the fields.
  const [page, setPage] = React.useState<string | null>(null);
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

  // The Filter menu's fields (FilterMenu): each with its values, what is chosen in it, and how it reads on its row.
  const one = <T,>(set: ReadonlySet<T>, words: (v: T) => string) => (set.size === 1 ? words([...set][0]) : String(set.size));
  const fields: MenuField[] = [];
  if (players.some((g) => g.players.length > 0)) {
    fields.push({
      id: "players",
      name: "Player",
      icon: User,
      values: players.flatMap((g) =>
        g.players.map((p) => ({ value: p.key, label: p.name, lead: p.number, keywords: p.number ? [p.number] : [], group: g.teamName || "Other players" })),
      ),
      isOn: (v) => filters.players.has(v),
      toggle: (v) => toggle("players", v),
      clear: () => set("players", new Set()),
      count: filters.players.size,
      summary: one(filters.players, playerName),
      footer: playerExtra || undefined,
    });
  }
  if (teams && teams.length > 1) {
    fields.push({
      id: "teams",
      name: "Team",
      icon: Shield,
      values: teams.map((t) => ({ value: t, label: t })),
      isOn: (v) => filters.teams.has(v),
      toggle: (v) => toggle("teams", v),
      clear: () => set("teams", new Set()),
      count: filters.teams.size,
      summary: one(filters.teams, (t) => t),
    });
  }
  fields.push({
    id: "shotTypes",
    name: "Shot type",
    icon: Crosshair,
    values: SHOT_TYPE_OPTIONS,
    isOn: (v) => filters.shotTypes.has(v),
    toggle: (v) => toggle("shotTypes", v),
    clear: () => set("shotTypes", new Set()),
    count: filters.shotTypes.size,
    summary: one(filters.shotTypes, (v) => SHOT_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v),
  });
  fields.push({
    id: "situations",
    name: "Situation",
    icon: Zap,
    values: SITUATION_OPTIONS,
    isOn: (v) => filters.situations.has(v),
    toggle: (v) => toggle("situations", v),
    clear: () => set("situations", new Set()),
    count: filters.situations.size,
    summary: one(filters.situations, (v) => SITUATION_OPTIONS.find((o) => o.value === v)?.label ?? v),
  });
  // When: the quarters (any of them) and one moment at a time.
  const whenValues = [
    ...(periods.length > 1 ? periods.map((p) => ({ value: `period:${p}`, label: periodLabel(p), group: "Quarter" })) : []),
    ...(moments
      ? MOMENT_OPTIONS.map((m) => {
          const why = moments.why?.[m.value] ?? (moments.counts[m.value] === 0 ? "None here" : null);
          return { value: `moment:${m.value}`, label: m.label, group: "Moment", disabledReason: filters.moment === m.value ? null : why };
        })
      : []),
  ];
  if (whenValues.length > 0) {
    const whenCount = filters.periods.size + (filters.moment ? 1 : 0);
    fields.push({
      id: "when",
      name: "When",
      icon: Clock,
      values: whenValues,
      isOn: (v) => (v.startsWith("period:") ? filters.periods.has(Number(v.slice(7))) : filters.moment === v.slice(7)),
      toggle: (v) => {
        if (v.startsWith("period:")) set("periods", toggled(filters.periods, Number(v.slice(7))));
        else {
          const m = v.slice(7) as GameMoment;
          set("moment", filters.moment === m ? null : m);
        }
      },
      clear: () => onChange({ ...filters, periods: new Set(), moment: null }),
      count: whenCount,
      summary:
        whenCount === 1
          ? filters.moment
            ? (MOMENT_OPTIONS.find((m) => m.value === filters.moment)?.label ?? filters.moment)
            : periodLabel([...filters.periods][0])
          : String(whenCount),
    });
  }
  if (labels.length > 0) {
    fields.push({
      id: "labels",
      name: "Labels",
      icon: Tag,
      values: labels.map((l) => ({ value: l.id, label: l.name })),
      isOn: (v) => !!filters.labels?.has(v),
      toggle: (v) => toggle("labels", v),
      clear: () => set("labels", new Set()),
      count: filters.labels?.size ?? 0,
      summary: one(filters.labels ?? new Set<string>(), labelName),
    });
  }
  // The token of a field opens that field's page.
  const pageOf: Partial<Record<PlayFilterField, string>> = { players: "players", teams: "teams", shotTypes: "shotTypes", situations: "situations", periods: "when", moment: "when", labels: "labels" };

  const clearPopover = onClearAll ?? (() => onChange({ ...EMPTY_PLAY_FILTERS, types: filters.types }));
  const popoverCount = count - (filters.types.size > 0 ? 1 : 0);

  return (
    // A container of its own (it is never a scrolling list's ancestor), so the first row lays out by the bar's width.
    <div className={cn("@container/bar flex shrink-0 flex-col gap-2", className)}>
      {/* Wide, the scope and Filter with Presets share one line. In a narrow list column (under 36rem) the scope
          takes a line of its own, wrapping inside itself, and Filter and Presets start the next: nothing squeezes
          a team's name or runs under another control. */}
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        {scope && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 @max-[36rem]/bar:basis-full">{scope}</div>}
        <div className={cn("flex shrink-0 items-center gap-1", !scope && "flex-1")}>
          <Popover
            modal={modal}
            open={open}
            onOpenChange={(o) => {
              if (!o) setPage(null);
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
            <PopoverContent
              align="start"
              className="w-auto overflow-hidden p-0"
              // Esc on a field's page goes back to the fields; on the fields it closes, as a menu does.
              onEscapeKeyDown={(e) => {
                if (page !== null) {
                  e.preventDefault();
                  setPage(null);
                }
              }}
            >
              <FilterMenu
                fields={fields}
                page={page}
                onPage={setPage}
                inputRef={searchRef}
                footer={
                  popoverCount > 0 ? (
                    <button
                      type="button"
                      onClick={clearPopover}
                      className="h-7 w-full rounded-md px-2 text-left text-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
                    >
                      Clear these filters
                    </button>
                  ) : undefined
                }
              />
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
              onEdit={() => {
                setPage(pageOf[t.field] ?? null);
                onOpenChange(true);
              }}
              onRemove={() => onChange(clearField(filters, t.field))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
