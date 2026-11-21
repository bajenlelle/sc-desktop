import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, Play, Plus, Tag } from "lucide-react";
import { eventHue, eventLabel, formatGameClock, periodLabel, playClock, playerName, type EventHue } from "@scoutable/shared/lib/events";
import { teamCode } from "@scoutable/shared/lib/play-row";
import type { Label } from "@scoutable/shared/types/labels";
import type { PlayByPlayEvent } from "@/types/match";
import { LabelChip } from "@/components/labels/LabelChip";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * One play row for every list of plays (Teams Plays, the game view, Add clips,
 * the playlist editor; docs/superpowers/specs/2026-11-21-play-row-design.md):
 * one line, read left to right as when · what · who · the coach's labels, with
 * the score and the two things to do with a play at the right. Each list keeps
 * its own row element (what a click, a drag or a menu does differs) and draws
 * its cells with `PlayRowCells`.
 */

/** Every play row is this tall, whatever it holds: Teams and Add clips window their lists by it. */
export const PLAY_ROW_HEIGHT = 32;

/** Hover-only row buttons also show for the focused row, keyboard focus, and the row whose picker is open. */
export const REVEAL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[focused]:opacity-100";

/**
 * The one highlight that follows the playing item: a single element that
 * springs from row to row rather than a class that appears and vanishes.
 */
export function ActiveRowPill() {
  return (
    <motion.div
      layoutId="active-row"
      transition={springs.standard}
      aria-hidden
      className="pointer-events-none absolute inset-y-0.5 inset-x-1 rounded-md bg-fill-2"
    />
  );
}

/**
 * The row element's classes: one line, a container its cells measure (a narrow
 * row gives way in a set order), and the neutral hover, pressed and selected
 * fills. `menuOpen` outlines the row a menu is about, as Finder does.
 */
export function playRowClass({ selected, menuOpen = false }: { selected: boolean; menuOpen?: boolean }): string {
  return cn(
    "group @container/row relative flex h-8 w-full shrink-0 cursor-default select-none items-center gap-2.5 pr-2 pl-1 text-left text-sm outline-none transition-colors duration-100",
    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
    selected ? "bg-row-selected text-foreground" : "hover:bg-fill-1 active:bg-fill-2",
    menuOpen && "ring-2 ring-inset ring-selection",
  );
}

/** One colour family per kind of play; shot value doesn't deepen it (a dot is too small to carry it). */
const HUE_DOT: Record<EventHue, string> = {
  make: "bg-emerald-500",
  miss: "bg-rose-500",
  rebound: "bg-blue-500",
  assist: "bg-cyan-500",
  steal: "bg-violet-500",
  block: "bg-violet-600",
  turnover: "bg-amber-500",
  foul: "bg-orange-500",
  neutral: "bg-slate-400",
};

/** The play's kind as a dot, as the event filter chips mark theirs. */
export function EventDot({ event, className }: { event: PlayByPlayEvent; className?: string }) {
  return <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", HUE_DOT[eventHue(event)], className)} />;
}

/** A row action's tooltip: what it does, and the key that does the same. */
export function RowTip({ label, keyHint, children }: { label: string; keyHint?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {label}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

const iconButton =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,transform,opacity,color] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-90 active:bg-fill-3 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:opacity-100 [&_svg]:size-3.5";

/**
 * The tag button. A plain button that forwards its ref and props, so a list can
 * make it a picker's trigger; `visible` keeps it shown (the play on screen).
 */
export const RowLabelButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { visible?: boolean }>(
  function RowLabelButton({ visible = false, className, ...rest }, ref) {
    return (
      <button ref={ref} type="button" aria-label="Label this play" {...rest} className={cn(iconButton, !visible && REVEAL, className)}>
        <Tag />
      </button>
    );
  },
);

export type PlaylistSlotStatus = "none" | "in" | "added" | "empty";

/**
 * Where a row says whether its play is in the target playlist: + to add it,
 * a ✓ that arrives in the accent and settles to grey after an add from this
 * view (a click takes it out again), a still ✓ for a play that was in before,
 * or nothing (the slot's room is kept, so nothing moves).
 */
export function RowPlaylistSlot({
  status,
  targetName,
  onAdd,
  onRemove,
  visible = false,
}: {
  status: PlaylistSlotStatus;
  targetName: string | null;
  onAdd?: (anchor: HTMLElement) => void;
  onRemove?: () => void;
  visible?: boolean;
}) {
  const target = targetName ?? "the playlist";
  if (status === "none") {
    const label = targetName ? `Add to ${targetName}` : "Add to a playlist";
    return (
      <RowTip label={label} keyHint="A">
        <button type="button" aria-label={label} className={cn(iconButton, !visible && REVEAL)} onClick={(e) => onAdd?.(e.currentTarget)}>
          <Plus />
        </button>
      </RowTip>
    );
  }
  if (status === "added") {
    return (
      <RowTip label={`Remove from ${target}`}>
        <button type="button" aria-label={`In ${target}. Remove`} className={cn(iconButton, "added-settle")} onClick={() => onRemove?.()}>
          <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.snappy} className="flex">
            <Check className="stroke-[2.5]" />
          </motion.span>
        </button>
      </RowTip>
    );
  }
  if (status === "in") {
    return (
      <RowTip label={`Already in ${target}`}>
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground" aria-label={`Already in ${target}`}>
          <Check className="size-3.5" />
        </span>
      </RowTip>
    );
  }
  return <span aria-hidden className="size-6 shrink-0" />;
}

export interface PlayRowCellsProps {
  event: PlayByPlayEvent;
  /** "Q1 09:47" where the list has no quarter headers; "09:47" under them. */
  clock: "with-period" | "clock-only";
  /** The play on screen: ▶ in the Now slot. */
  now: boolean;
  /** The play on screen: its name in medium weight. */
  strong: boolean;
  /** Draw the team's code (the game view with both teams listed). */
  team: boolean;
  labels: readonly Label[];
  /** The game ("vs Zeta") in a list of several games; undefined draws no column. */
  context?: string | null;
  /** The score after a scoring play; undefined draws no column, null an empty one. */
  score?: { home: number; away: number; scored: 1 | 2 } | null;
  /** The play can't play here: its words dim, its actions don't. */
  dim?: boolean;
  /** Before the Now slot: a checkbox, a group rail. */
  lead?: ReactNode;
  /** Before the event: the editor's group pill. */
  pill?: ReactNode;
  /** Before the actions: the editor's trim and note marks. */
  marks?: ReactNode;
  /** The row's two actions (label, and the playlist slot or Remove). */
  actions: ReactNode;
}

const cell = "relative z-10";

/** The row's cells, in the column order every list shares. */
export function PlayRowCells({ event: e, clock, now, strong, team, labels, context, score, dim = false, lead, pill, marks, actions }: PlayRowCellsProps) {
  const faded = dim && "opacity-55";
  const clockText = clock === "with-period" ? playClock(e) : e.gameClockTime ? formatGameClock(e.gameClockTime) : periodLabel(e.period);
  const who = e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : (e.eventTeam?.teamName ?? "");
  const shown = labels.slice(0, 2);
  const more = labels.slice(2);
  const what = eventLabel(e);
  return (
    <>
      {lead}
      <span className={cn(cell, "flex w-3 shrink-0 justify-center")}>
        {now && <Play aria-label="Playing" className="size-2.5 fill-current text-foreground" />}
      </span>
      <span className={cn(cell, "shrink-0 text-muted-foreground nums", clock === "with-period" ? "w-14" : "w-10", faded)}>{clockText}</span>
      {team && <span className={cn(cell, "w-9 shrink-0 truncate text-muted-foreground", faded)}>{teamCode(e) ?? ""}</span>}
      {pill && <span className={cn(cell, "shrink-0")}>{pill}</span>}
      <span className={cn(cell, "flex w-[104px] shrink-0 items-center gap-1.5 @max-[400px]/row:w-[7px]", faded)} title={what}>
        <EventDot event={e} />
        <span className="truncate text-muted-foreground @max-[400px]/row:hidden">{what}</span>
      </span>
      <span className={cn(cell, "flex min-w-0 flex-1 items-center gap-1.5", faded)}>
        <span className={cn("min-w-0 truncate", strong && "font-medium")}>{who}</span>
        {shown.map((l) => (
          <LabelChip key={l.id} label={l} variant="quiet" />
        ))}
        {more.length > 0 && (
          <span className="shrink-0 text-subheadline text-muted-foreground" title={more.map((l) => l.name).join(", ")}>
            +{more.length}
          </span>
        )}
      </span>
      {context !== undefined && (
        <span className={cn(cell, "min-w-0 max-w-40 shrink truncate text-muted-foreground", faded)}>{context ?? ""}</span>
      )}
      {score !== undefined && (
        <span
          className={cn(cell, "flex w-10 shrink-0 justify-end text-muted-foreground nums", faded)}
          aria-label={score ? `${score.home} to ${score.away}` : undefined}
        >
          {score && (
            <>
              <span className={cn(score.scored === 1 && "font-semibold text-foreground")}>{score.home}</span>
              <span aria-hidden>–</span>
              <span className={cn(score.scored === 2 && "font-semibold text-foreground")}>{score.away}</span>
            </>
          )}
        </span>
      )}
      {marks && <span className={cn(cell, "flex shrink-0 items-center gap-1")}>{marks}</span>}
      <span className={cn(cell, "flex shrink-0 items-center gap-0.5")} onClick={(ev) => ev.stopPropagation()}>
        {actions}
      </span>
    </>
  );
}
