import { memo, type ReactNode } from "react";
import { Check, Play, Plus, Tag } from "lucide-react";
import { SITUATION_OPTIONS } from "@scoutable/shared/lib/clip-filters";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import type { Score } from "@scoutable/shared/lib/game-flow";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { Label } from "@scoutable/shared/types/labels";
import { ActiveRowPill } from "@/components/editor/clip-rows";
import { LabelChip } from "@/components/labels/LabelChip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pressable } from "@/lib/pressable";
import { cn } from "@/lib/utils";

/** The feed's qualifiers in words, as the Add clips filters name them. */
const QUALIFIER_WORDS = new Map(
  SITUATION_OPTIONS.filter((o) => o.value.startsWith("qual:")).map((o) => [o.value.slice(5), o.label]),
);

export type CollectStatus = "none" | "in" | "added";

const iconButton =
  "flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-[background-color,transform,opacity] duration-100 hover:bg-fill-2 active:scale-90 active:bg-fill-3 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection [&_svg]:size-3.5";

/**
 * One play in the game's list: the editor's two-line row (event and player;
 * clock, team and what the feed says about the play), with the score beside
 * every basket so the eye runs down the score like a scoresheet, the coach's
 * labels, and the two things to do with it: label it, add it to the playlist.
 * The row itself plays the play. Memoised: while the game runs only the row
 * that stops being current and the one that becomes it are drawn again.
 */
export const GamePlayRow = memo(function GamePlayRow({
  play,
  active,
  playing,
  score,
  scored,
  note,
  labels,
  collect,
  targetName,
  labelPicker,
  onPlay,
  onAdd,
  onRemove,
  onLabel,
}: {
  play: TimedPlay;
  active: boolean;
  /** The current play, with footage on the stage (not merely selected). */
  playing: boolean;
  /** The score after the play; shown when the play scored. */
  score: Score | null;
  /** Which side the play scored for. */
  scored: 1 | 2 | null;
  /** "Lead change", "Tied at 51". */
  note: string | null;
  labels: readonly Label[];
  collect: CollectStatus;
  targetName: string | null;
  /** The label picker, on the one row that is being labelled; the plain button otherwise. */
  labelPicker: ReactNode | null;
  onPlay: (play: TimedPlay) => void;
  onAdd: (play: TimedPlay) => void;
  onRemove: (play: TimedPlay) => void;
  onLabel: (play: TimedPlay) => void;
}) {
  const e = play.event;
  const colors = eventColors(e);
  const outside = play.reach !== "in";
  const shown = labels.slice(0, 2);
  const more = labels.length - shown.length;
  const words = e.qualifiers.map((q) => QUALIFIER_WORDS.get(q)).filter(Boolean);
  const number = e.player?.pno ? `#${e.player.pno} ` : "";
  const quiet = "opacity-0 group-hover:opacity-100";

  return (
    <div
      {...pressable(() => onPlay(play), { space: false })}
      data-row-key={play.key}
      aria-current={active || undefined}
      className={cn(
        "group relative flex min-h-11 w-full cursor-default scroll-my-16 select-none items-stretch gap-2 pr-2 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
        outside && "opacity-50",
      )}
    >
      {active && <ActiveRowPill />}
      <span className={cn("relative z-10 w-[3px] shrink-0 self-stretch", colors.strip)} aria-hidden />
      <span className="relative z-10 flex min-w-0 flex-1 flex-col justify-center py-1.5 pl-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", colors.badge)}>
            {eventLabel(e)}
          </span>
          <span className="truncate text-sm font-medium">
            {e.player ? `${number}${playerName(e)}` : (e.eventTeam?.teamName ?? "")}
          </span>
          {shown.map((l) => (
            <LabelChip key={l.id} label={l} className="shrink-0 whitespace-nowrap" />
          ))}
          {more > 0 && <span className="shrink-0 text-xs text-muted-foreground">+{more}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-subheadline text-muted-foreground nums">
          <span className="shrink-0">{formatGameClock(e.gameClockTime)}</span>
          {e.eventTeam?.teamName && e.player && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{e.eventTeam.teamName}</span>
            </>
          )}
          {words.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{words.join(", ")}</span>
            </>
          )}
          {note && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 font-medium text-foreground">{note}</span>
            </>
          )}
          {outside && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{play.reach === "before" ? "Before the video starts" : "After the video ends"}</span>
            </>
          )}
        </span>
      </span>
      {score && scored && (
        <span className="relative z-10 flex shrink-0 items-center text-sm text-muted-foreground nums" aria-label={`${score.home} to ${score.away}`}>
          <span className={cn(scored === 1 && "font-semibold text-foreground")}>{score.home}</span>
          <span aria-hidden>–</span>
          <span className={cn(scored === 2 && "font-semibold text-foreground")}>{score.away}</span>
        </span>
      )}
      <span className="relative z-10 flex shrink-0 items-center gap-0.5" onClick={(ev) => ev.stopPropagation()}>
        {playing && <Play aria-label="Playing" className="mr-0.5 size-3.5 fill-current text-primary" />}
        {labelPicker ?? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Label this play"
                className={cn(iconButton, "text-muted-foreground hover:text-foreground", !active && labels.length === 0 && quiet)}
                onClick={() => onLabel(play)}
              >
                <Tag />
              </button>
            </TooltipTrigger>
            <TooltipContent>Label</TooltipContent>
          </Tooltip>
        )}
        {collect === "none" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={targetName ? `Add to ${targetName}` : "Add to a playlist"}
                className={cn(iconButton, "text-muted-foreground hover:text-foreground", !active && quiet)}
                onClick={() => onAdd(play)}
              >
                <Plus />
              </button>
            </TooltipTrigger>
            <TooltipContent>{targetName ? `Add to ${targetName}` : "Add to a playlist"}</TooltipContent>
          </Tooltip>
        ) : collect === "added" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`In ${targetName ?? "the playlist"}. Remove`}
                className={cn(iconButton, "text-primary")}
                onClick={() => onRemove(play)}
              >
                <Check className="stroke-[2.5]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Added just now. Click to take it out again.</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground" aria-label={`Already in ${targetName ?? "the playlist"}`}>
                <Check className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Already in {targetName ?? "the playlist"}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  );
});
