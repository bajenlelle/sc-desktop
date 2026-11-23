import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The line over every list of plays (the game view, Teams' Plays, Add clips, the editor): how many are listed,
 * and Clear while filters narrow them, always in the same place, as Linear's view header keeps its count and
 * filters in one strip. `lead` sits before the count (Add clips' Select all, a Stats pick); `trail` closes the
 * line on the right (the order the list is in, Add all).
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
  className?: string;
}) {
  const word = (filtered && total !== undefined ? total : count) === 1 ? noun[0] : noun[1];
  return (
    <div className={cn("flex h-8 shrink-0 items-center gap-2 text-subheadline text-muted-foreground nums", className)}>
      {lead}
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
    </div>
  );
}
