import type { ComponentProps, ReactNode } from "react";
import { Check, Minus, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** What a list's selection gives its count line: the select-all check, and the bar's buttons while plays are selected. */
export interface CountLineSelection {
  /** Of the listed plays that can be selected (not those already in the target). */
  state: "none" | "some" | "all";
  /** How many are selected. */
  selected: number;
  /** How many listed plays can be selected. */
  selectable: number;
  onSelectAll: () => void;
  onClear: () => void;
  /** The bar's buttons, while plays are selected: Add to the target first, then the rest. */
  actions: ReactNode;
}

/**
 * The line over every list of plays (the game view, Teams' Plays, Add clips, the editor): how many are listed,
 * and Clear while filters narrow them, always in the same place, as Linear's view header keeps its count and
 * filters in one strip. `trail` closes the line on the right (the order the list is in, Add all).
 *
 * With `selection` it leads with a select-all check (all the listed plays not already in the target; NN/g,
 * PatternFly, Gmail), and while plays are selected the same line becomes the selection's bar: "12 selected"
 * and its buttons, where the count was, instead of a pill floating over the rows (Material's contextual
 * header). The line keeps its height, so nothing under it moves.
 */
export function PlaysCountLine({
  count,
  total,
  noun = ["play", "plays"],
  detail,
  filtered,
  onClear,
  lead,
  trail,
  selection,
  className,
}: {
  count: number;
  /** Shown as "24 of 430 plays" while filtered; without it the line says only what is listed. */
  total?: number;
  /** Singular and plural: the editor lists clips. */
  noun?: readonly [string, string];
  /** After the count: "in 3 games". */
  detail?: string;
  filtered: boolean;
  /** Clear filters, offered while `filtered`. */
  onClear?: () => void;
  lead?: ReactNode;
  trail?: ReactNode;
  selection?: CountLineSelection;
  className?: string;
}) {
  const word = (filtered && total !== undefined ? total : count) === 1 ? noun[0] : noun[1];
  const selecting = !!selection && selection.selected > 0;
  return (
    <div
      className={cn(
        "@container/count flex h-8 shrink-0 items-center gap-2 text-subheadline text-muted-foreground nums",
        selecting && "bg-fill-1",
        className,
      )}
    >
      {lead}
      {selection && <SelectAllCheck selection={selection} />}
      {selecting ? (
        <div role="toolbar" aria-label="Selection" className="flex min-w-0 flex-1 items-center gap-2">
          <span role="status" className="shrink-0 font-medium text-foreground">
            {selection.selected} selected
          </span>
          <span className="ml-auto flex min-w-0 items-center gap-1">
            {selection.actions}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Deselect all"
                  onClick={selection.onClear}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Deselect all (Esc)</TooltipContent>
            </Tooltip>
          </span>
        </div>
      ) : (
        <>
          <span role="status" className="min-w-0 truncate">
            {filtered && total !== undefined && total !== count ? `${count} of ${total} ${word}` : `${count} ${word}`}
            {detail ? ` ${detail}` : ""}
          </span>
          {filtered && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="-mx-1 shrink-0 rounded px-1 outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection"
            >
              Clear filters
            </button>
          )}
          {trail && <span className="ml-auto flex shrink-0 items-center gap-2">{trail}</span>}
        </>
      )}
    </div>
  );
}

/** The select-all check: none, some (a dash) or all of the listed plays that can be selected. */
function SelectAllCheck({ selection }: { selection: CountLineSelection }) {
  const { state, selectable } = selection;
  const all = state === "all";
  const label = all ? "Deselect all" : `Select all ${selectable}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="checkbox"
          aria-checked={all ? true : state === "some" ? "mixed" : false}
          aria-label={label}
          disabled={selectable === 0 && state === "none"}
          // Some or none selects all of them; all lets them go (× and Esc do too).
          onClick={all ? selection.onClear : selection.onSelectAll}
          className="-m-1 flex shrink-0 items-center justify-center rounded p-1 outline-none focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-40"
        >
          <span
            aria-hidden
            className={cn(
              "flex size-3.5 items-center justify-center rounded-[4px] border transition-[background-color,border-color] duration-100",
              state === "none" ? "border-muted-foreground/50 hover:border-foreground/70" : "border-primary bg-primary text-primary-foreground",
            )}
          >
            {all && <Check className="size-2.5" strokeWidth={3.5} />}
            {state === "some" && <Minus className="size-2.5" strokeWidth={3.5} />}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{all ? "Deselect all (Esc)" : `Select all ${selectable} (⌘A)`}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bar's primary button: "Add 12 to Keys", shortening to "Add 12" in a narrow list, never to an icon alone.
 */
export function BarAddButton({ count, targetName, onClick, shortcut = "⌘↩" }: { count: number; targetName: string | null; onClick: () => void; shortcut?: string | null }) {
  const title = `Add ${count} ${count === 1 ? "play" : "plays"}${targetName ? ` to ${targetName}` : ""}${shortcut ? ` (${shortcut})` : ""}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={`Add ${count} ${count === 1 ? "play" : "plays"} to ${targetName ?? "a playlist"}`}
      onClick={onClick}
      className="flex h-6 min-w-0 shrink items-center gap-1 rounded-md bg-primary px-2 text-footnote font-medium text-primary-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-selection"
    >
      <span className="shrink-0">Add {count}</span>
      {targetName && <span className="hidden min-w-0 truncate @min-[24rem]/count:inline">to {targetName}</span>}
      {!targetName && <span className="hidden @min-[24rem]/count:inline">to…</span>}
    </button>
  );
}

/** A secondary button in the bar: quiet until hovered, its words hidden in a narrow list. */
export function BarButton({ icon, label, title, children, ...rest }: { icon: ReactNode; label: string; title: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      {...rest}
      className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-footnote text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2 data-[state=open]:text-foreground [&_svg]:size-3.5"
    >
      {icon}
      <span className="hidden @min-[30rem]/count:inline">{label}</span>
      {children}
    </button>
  );
}
