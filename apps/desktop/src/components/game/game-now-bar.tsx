import type { ReactElement, ReactNode, Ref } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import type { Score } from "@scoutable/shared/lib/game-flow";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { Label } from "@scoutable/shared/types/labels";
import { LabelChip } from "@/components/labels/LabelChip";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { CollectStatus } from "./game-play-row";
import type { GameMoment } from "./use-game-playback";

/**
 * What is on screen, in words, right under the footage: the current play
 * with the clock and the score, or where the video is when no play is on
 * (warm-up, a break, the start of a quarter, after the final whistle) with
 * the way past it. It is
 * also where the play on screen is labelled and added, with the keys that do
 * the same shown on the buttons: the bar always names the play A will add.
 */
export function GameNowBar({
  play,
  footage,
  moment,
  score,
  breakScore,
  labels,
  collect,
  targetName,
  labelButton,
  addRef,
  onAdd,
  onSkip,
}: {
  play: TimedPlay | null;
  /** Footage is playing: the play is "now". Without it, the play is only selected. */
  footage: boolean;
  moment: GameMoment | null;
  /** The score after the current play. */
  score: Score | null;
  /** The score a break, the final whistle or a period that has just started stands at. */
  breakScore: Score | null;
  labels: readonly Label[];
  collect: CollectStatus;
  targetName: string | null;
  /** Wraps the Label button in the label picker. */
  labelButton: (trigger: ReactElement) => ReactNode;
  /** The Add button: where a picker it has to open grows from, for the A key as for a click. */
  addRef: Ref<HTMLButtonElement>;
  onAdd: () => void;
  /** Past the stretch with no basketball in it: to tip-off, or to the next period. */
  onSkip: (() => void) | null;
}) {
  const between = footage && moment && moment.phase !== "live";
  const scoreText = (s: Score | null) => (s ? `${s.home}–${s.away}` : null);

  if (between || !play) {
    let text: string;
    let skip: string | null = null;
    if (!moment || !footage) text = "Choose a play in the list or on the timeline.";
    else if (moment.phase === "before") {
      text = "Before tip-off";
      skip = "Skip to tip-off";
    } else if (moment.phase === "after") {
      text = ["After the final whistle", scoreText(breakScore)].filter(Boolean).join(" · ");
    } else if (moment.phase === "break") {
      const half = moment.period === 2 && moment.next === 3;
      text = [half ? "Half-time" : `End of ${periodLabel(moment.period ?? 1)}`, scoreText(breakScore)].filter(Boolean).join(" · ");
      skip = moment.next ? `Skip to ${periodLabel(moment.next)}` : null;
    } else if (moment.period !== null) {
      // In a period, before its first play.
      text = [`Start of ${periodLabel(moment.period)}`, scoreText(breakScore)].filter(Boolean).join(" · ");
    } else {
      text = "Before the first play";
    }
    return (
      <div className="flex h-11 shrink-0 items-center gap-3 px-1">
        <p className="min-w-0 truncate text-callout text-muted-foreground nums">{text}</p>
        {skip && onSkip && (
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onSkip}>
            {skip}
          </Button>
        )}
      </div>
    );
  }

  const e = play.event;
  const colors = eventColors(e);
  // Some feeds keep no game clock: the quarter and the score stand without it.
  const where = [periodLabel(e.period), e.gameClockTime && formatGameClock(e.gameClockTime), scoreText(score)].filter(Boolean).join(" · ");
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-1">
      <span className="shrink-0 text-callout text-muted-foreground nums">{where}</span>
      <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", colors.badge)}>{eventLabel(e)}</span>
      <span className="min-w-0 truncate text-callout font-medium">
        {e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : (e.eventTeam?.teamName ?? "")}
      </span>
      <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
        {labels.slice(0, 3).map((l) => (
          <LabelChip key={l.id} label={l} className="shrink-0 whitespace-nowrap" />
        ))}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {labelButton(
          <Button variant="outline" size="sm" aria-label="Label this play">
            <Tag />
            Label
            <Kbd className="ml-0.5 h-4 min-w-4 text-caption">G</Kbd>
          </Button>,
        )}
        {collect === "none" ? (
          <Button ref={addRef} size="sm" onClick={onAdd} aria-label={targetName ? `Add this play to ${targetName}` : "Add this play to a playlist"}>
            <Plus />
            Add
            <Kbd className="ml-0.5 h-4 min-w-4 border-white/25 bg-white/15 text-caption text-primary-foreground">A</Kbd>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled aria-label={`In ${targetName ?? "the playlist"}`}>
            <Check />
            {collect === "added" ? "Added" : "In playlist"}
          </Button>
        )}
      </span>
    </div>
  );
}
