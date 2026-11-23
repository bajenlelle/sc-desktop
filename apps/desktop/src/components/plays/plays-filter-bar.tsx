import * as React from "react";
import { CircleDot, Clock, Crosshair, ListFilter, Shield, Tag, User, X, Zap } from "lucide-react";
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


/** The Filter menu's fields for a list's filters, the tokens of what is on, and how many fields the menu holds on. */
export function usePlayFilterFields({
  filters,
  onChange,
  players,
  labels,
  periods = [],
  moments = null,
  teams,
  playerExtra,
  events = false,
  leadFields = [],
}: {
  filters: PlayFilters;
  onChange: (next: PlayFilters) => void;
  players: readonly PlayerGroup[];
  labels: readonly Label[];
  periods?: readonly number[];
  moments?: { counts: Partial<Record<GameMoment, number>>; why?: Partial<Record<GameMoment, string>> } | null;
  teams?: readonly string[];
  playerExtra?: React.ReactNode;
  /** An Event field in the menu, for a list without the event chips (the editor). */
  events?: boolean;
  /** Fields of the view's own before the shared ones (the editor's Game). */
  leadFields?: readonly MenuField[];
}) {
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
  // Where the events have their chips, always in view, a token for them would say it twice.
  const tokens = appliedFilters(filters, { player: playerName, label: labelName }).filter((t) => events || t.field !== "types");

  // The Filter menu's fields (FilterMenu): each with its values, what is chosen in it, and how it reads on its row.
  const one = <T,>(set: ReadonlySet<T>, words: (v: T) => string) => (set.size === 1 ? words([...set][0]) : String(set.size));
  const fields: MenuField[] = [];
  if (events) {
    fields.push({
      id: "types",
      name: "Event",
      icon: CircleDot,
      values: PLAY_EVENT_OPTIONS,
      isOn: (v) => filters.types.has(v),
      toggle: (v) => toggle("types", v),
      clear: () => set("types", new Set()),
      count: filters.types.size,
      summary: one(filters.types, (v) => PLAY_EVENT_OPTIONS.find((o) => o.value === v)?.label ?? v),
    });
  }
  fields.push(...leadFields);
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
  const count = playFiltersCount(filters);
  // What the menu holds on: everything but the events where they have their chips; plus the view's own fields.
  const menuCount = count - (!events && filters.types.size > 0 ? 1 : 0) + leadFields.filter((f) => f.count > 0).length;
  return { fields, tokens, menuCount };
}

/** The token of a field opens that field's page in the menu. */
export const PAGE_OF_FIELD: Partial<Record<PlayFilterField, string>> = {
  types: "types",
  players: "players",
  teams: "teams",
  shotTypes: "shotTypes",
  situations: "situations",
  periods: "when",
  moment: "when",
  labels: "labels",
};

/** "Clear these filters", at the foot of the menu's fields. */
export function ClearFiltersRow({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="h-7 w-full rounded-md px-2 text-left text-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
    >
      Clear these filters
    </button>
  );
}

/**
 * The Filter popover: the menu (FilterMenu) anchored to its trigger. Esc on a field's page goes back to the
 * fields; on the fields it closes, as a menu does. Closing forgets the page.
 */
export function FilterPopover({
  trigger,
  fields,
  page,
  onPage,
  open,
  onOpenChange,
  searchRef,
  footer,
  modal = false,
  align = "start",
}: {
  trigger: React.ReactNode;
  fields: readonly MenuField[];
  page: string | null;
  onPage: (page: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchRef?: React.Ref<HTMLInputElement>;
  footer?: React.ReactNode;
  modal?: boolean;
  align?: "start" | "end";
}) {
  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(o) => {
        if (!o) onPage(null);
        onOpenChange(o);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-auto overflow-hidden p-0"
        onEscapeKeyDown={(e) => {
          if (page !== null) {
            e.preventDefault();
            onPage(null);
          }
        }}
      >
        <FilterMenu fields={fields} page={page} onPage={onPage} inputRef={searchRef} footer={footer} />
      </PopoverContent>
    </Popover>
  );
}

/** The tokens of what is on, after any picks: a token's values open its field's page. */
export function FilterTokens({
  tokens,
  picks,
  onEdit,
  onRemove,
  className,
}: {
  tokens: readonly AppliedFilter[];
  picks?: React.ReactNode;
  onEdit: (field: PlayFilterField) => void;
  onRemove: (field: PlayFilterField) => void;
  className?: string;
}) {
  if (tokens.length === 0 && !picks) return null;
  return (
    <div role="group" aria-label="Filters on" className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {picks}
      {tokens.map((t) => (
        <FilterToken
          key={t.field}
          name={t.name}
          op={t.op}
          values={t.values.join(", ")}
          onEdit={() => onEdit(t.field)}
          onRemove={() => onRemove(t.field)}
        />
      ))}
    </div>
  );
}

/**
 * The filters over every list of plays (the game view, Teams' Plays, Add clips), as Linear keeps them: a row
 * with the list's scope (whose plays, which games), Filter and Presets; the event chips, one press away; and,
 * while anything else is on, a token per filter that says what it is and takes it off. Everything but the
 * events lives in the Filter menu (FilterMenu): its fields first, each opening a page of values with
 * checkmarks, and one search that finds values across every field ("#7", "Berg", "clutch"). A token opens its
 * field's page. A field is listed only where its values exist: quarters with more than one, moments where the
 * list has them, teams where `teams` is given. The editor has no bar: its toolbar's Filter opens the same menu.
 */
export function PlaysFilterBar({
  filters,
  onChange,
  scope,
  scopeFill = false,
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
  /** The scope takes the row's width (a switch that fills it); otherwise Filter and Presets follow it. */
  scopeFill?: boolean;
  /** The saved filters (FilterPresetsMenu), after Filter. */
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
  const { fields, tokens, menuCount } = usePlayFilterFields({ filters, onChange, players, labels, periods, moments, teams, playerExtra });
  const clearPopover = onClearAll ?? (() => onChange({ ...EMPTY_PLAY_FILTERS, types: filters.types }));

  const filterControls = (
    <div className={cn("flex shrink-0 items-center gap-1", !scope && "flex-1")}>
      <FilterPopover
        modal={modal}
        open={open}
        onOpenChange={onOpenChange}
        page={page}
        onPage={setPage}
        searchRef={searchRef}
        fields={fields}
        footer={menuCount > 0 ? <ClearFiltersRow onClear={clearPopover} /> : undefined}
        trigger={
          <button
            type="button"
            aria-label={menuCount > 0 ? `Filters, ${menuCount} on` : "Filters"}
            title="Filter (⌘F)"
            className={cn(quietControl, quietState(menuCount > 0), "text-xs font-medium [&_svg]:size-3.5")}
          >
            <ListFilter className="size-3.5" />
            Filter
            {menuCount > 0 && <span className="nums">{menuCount}</span>}
          </button>
        }
      />
      {presets}
    </div>
  );

  return (
    // A container of its own (it is never a scrolling list's ancestor), so the first row lays out by the bar's width.
    <div className={cn("@container/bar flex shrink-0 flex-col gap-2", className)}>
      {scopeFill ? (
        // Wide, the scope and Filter with Presets share one line. In a narrow list column (under 36rem) the scope
        // takes a line of its own, wrapping inside itself, and Filter and Presets start the next: nothing squeezes
        // a team's name or runs under another control.
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {scope && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 @max-[36rem]/bar:basis-full">{scope}</div>}
          {filterControls}
        </div>
      ) : (
        // The scope's controls and Filter with Presets as one run, left to right, as Linear's filter row: what
        // narrows the list sits beside what picks it, and wraps as a whole.
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {scope}
          {filterControls}
        </div>
      )}
      <EventTypeChips options={PLAY_EVENT_OPTIONS} selected={filters.types} onChange={(next) => onChange({ ...filters, types: next })} />
      <FilterTokens
        tokens={tokens}
        picks={picks}
        onEdit={(field) => {
          setPage(PAGE_OF_FIELD[field] ?? null);
          onOpenChange(true);
        }}
        onRemove={(field) => onChange(clearField(filters, field))}
      />
    </div>
  );
}
