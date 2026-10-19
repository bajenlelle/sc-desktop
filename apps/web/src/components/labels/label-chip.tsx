"use client";

import type { Label } from "@scoutable/shared/types/labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { labelChipClasses } from "./label-colors";

/** One label, as the pill it is everywhere: its colour, its name. The desktop's LabelChip. */
export function LabelChip({ label, className }: { label: Pick<Label, "name" | "color">; className?: string }) {
  return (
    <span
      title={label.name}
      className={cn(
        "inline-block max-w-32 min-w-0 truncate rounded-full px-2 py-0.5 text-xs leading-tight font-medium whitespace-nowrap",
        labelChipClasses[label.color],
        className,
      )}
    >
      {label.name}
    </span>
  );
}

/**
 * A row's labels in the little room a row has: the first two as chips, the
 * rest as "+3" with their names on hover, as the desktop's rows show them.
 * A chip that doesn't fit shortens before the player's name does (the row
 * keeps the name a minimum width).
 */
export function LabelChips({ labels, max = 2, overflowClassName }: { labels: readonly Label[]; max?: number; overflowClassName?: string }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const rest = labels.slice(max);
  return (
    <>
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("shrink-0 text-xs nums", overflowClassName ?? "text-muted-foreground")}>+{rest.length}</span>
          </TooltipTrigger>
          <TooltipContent>{rest.map((l) => l.name).join(", ")}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
