import type { ReactElement, ReactNode, Ref } from "react";
import { Check, Plus, Tag, Timer } from "lucide-react";
import { eventColors, eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import type { Score } from "@scoutable/shared/lib/game-flow";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { Label } from "@scoutable/shared/types/labels";
import { LabelChip } from "@/components/labels/LabelChip";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_MACOS } from "@/lib/platform";
import { labelDotClasses } from "@/lib/label-colors";
import { cn } from "@/lib/utils";
import { GameLink } from "@/components/entity-link";
import type { CollectStatus } from "./game-play-row";
import type { GameMoment } from "./use-game-playback";

/**
 * Where the video is when no play is on (warm-up, a break, the start of a
 * quarter, after the final whistle), in words, with the name of the way past
 * it; null while a play is on. The Now bar says it, and so do the player's
 * controls in full screen, where the Now bar is out of sight.
 */
export function betweenPlays({
  play,
  footage,
  moment,
  breakScore,
}: {
  play: TimedPlay | null;
  footage: boolean;
  moment: GameMoment | null;
  breakScore: Score | null;
}): { text: string; skip: string | null } | null {
  if (play && !(footage && moment && moment.phase !== "live")) return null;
  const score = breakScore ? `${breakScore.home}–${breakScore.away}` : null;
  if (!moment || !footage) return { text: "Choose a play in the list or on the timeline.", skip: null };
  if (moment.phase === "before") return { text: "Before tip-off", skip: "Skip to tip-off" };
  if (moment.phase === "after") return { text: ["After the final whistle", score].filter(Boolean).join(" · "), skip: null };
  if (moment.phase === "break") {
    const half = moment.period === 2 && moment.next === 3;
    return {
      text: [half ? "Half-time" : `End of ${periodLabel(moment.period ?? 1)}`, score].filter(Boolean).join(" · "),
      skip: moment.next ? `Skip to ${periodLabel(moment.next)}` : null,
    };
  }
  // In a period, before its first play.
  if (moment.period !== null) return { text: [`Start of ${periodLabel(moment.period)}`, score].filter(Boolean).join(" · "), skip: null };
  return { text: "Before the first play", skip: null };
}

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
  details,
  game,
  labels,
  collect,
  inLabel,
  targetName,
  labelButton,
  lastLabel,
  onLabelAgain,
  addRef,
  onAdd,
  onSkip,
  onFixSync,
}: {
  play: TimedPlay | null;
  /** Footage is playing: the play is "now". Without it, the play is only selected. */
  footage: boolean;
  moment: GameMoment | null;
  /** The score after the current play. */
  score: Score | null;
  /** The score a break, the final whistle or a period that has just started stands at. */
  breakScore: Score | null;
  /** After the clock and score: the play's qualifiers, what it did to the game, where it is outside the video. */
  details: readonly string[];
  /** Last on the line: the play's game by name, opening it at this play (a team's plays, across its games). */
  game?: { id: string; title: string; label: string };
  labels: readonly Label[];
  collect: CollectStatus;
  targetName: string | null;
  /** What the button says for a play the target has: "In playlist" unless told ("In report"). */
  inLabel?: string;
  /** Wraps the Label button in the label picker. */
  labelButton: (trigger: ReactElement) => ReactNode;
  /** The label used last: one press puts it on this play, without the picker. Null until a label has been used. */
  lastLabel: Label | null;
  onLabelAgain: () => void;
  /** The Add button: where a picker it has to open grows from, for the A key as for a click. */
  addRef: Ref<HTMLButtonElement>;
  onAdd: () => void;
  /** Past the stretch with no basketball in it: to tip-off, or to the next period. */
  onSkip: (() => void) | null;
  /** Fix sync on the play on screen: find where it really happens. Absent when the play can't be found here (no footage, or it is outside the video). */
  onFixSync?: () => void;
}) {
  const scoreText = (s: Score | null) => (s ? `${s.home}–${s.away}` : null);

  const between = betweenPlays({ play, footage, moment, breakScore });
  if (between || !play) {
    return (
      <div className="flex h-11 shrink-0 items-center gap-3 px-1">
        <p className="min-w-0 truncate text-callout text-muted-foreground nums">{between?.text}</p>
        {between?.skip && onSkip && (
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onSkip}>
            {between.skip}
          </Button>
        )}
      </div>
    );
  }

  const e = play.event;
  const colors = eventColors(e);
  // Some feeds keep no game clock: the quarter and the score stand without it.
  const where = [periodLabel(e.period), e.gameClockTime && formatGameClock(e.gameClockTime), scoreText(score), ...details].filter(Boolean).join(" · ");
  return (
    <div className="@container/now flex h-11 shrink-0 items-center gap-2 px-1">
      {/* The play's details follow the clock and score: in a narrow bar the line gives way at its end, whole in its tooltip. */}
      <span data-now="where" title={game ? [where, game.label].filter(Boolean).join(" · ") : where} className="min-w-0 truncate text-callout text-muted-foreground nums">
        {where}
        {game && (
          <>
            {where ? " · " : ""}
            <GameLink gameId={game.id} title={game.title} play={e.eventId}>
              {game.label}
            </GameLink>
          </>
        )}
      </span>
      <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium", colors.badge)}>{eventLabel(e)}</span>
      {/* The name has room for a number and a few letters before anything else gives way: in a narrow column the
          keys' hints go first, then the same-label-again button (⇧G still does it). */}
      <span data-now="name" className="min-w-16 flex-1 truncate text-callout font-medium">
        {e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : (e.eventTeam?.teamName ?? "")}
      </span>
      <span className="flex min-w-0 shrink-[4] items-center gap-1 overflow-hidden">
        {labels.slice(0, 3).map((l) => (
          <LabelChip key={l.id} label={l} className="shrink-0 whitespace-nowrap" />
        ))}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* The same label again: what a coach going through a game does most. At the window's usual width the
            bar has room for the label's colour and the key only; its name joins them when there is room. */}
        {lastLabel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hidden max-w-48 min-w-0 shrink-0 px-2 @min-[520px]/now:inline-flex"
                disabled={labels.some((l) => l.id === lastLabel.id)}
                onClick={onLabelAgain}
                aria-label={`Label this play ${lastLabel.name} again`}
              >
                <span className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses[lastLabel.color])} aria-hidden />
                <span className="hidden truncate @min-[780px]/now:inline">{lastLabel.name}</span>
                <Kbd className="hidden h-4 min-w-4 text-caption @min-[600px]/now:inline-flex">{IS_MACOS ? "⇧G" : "Shift G"}</Kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Label this play {lastLabel.name} again</TooltipContent>
          </Tooltip>
        )}
        {/* The play is in the wrong place: fixed here, on this video. Its words give way before the name does. */}
        {onFixSync && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="px-2" onClick={onFixSync} aria-label="Fix sync">
                <Timer />
                <span className="hidden @min-[680px]/now:inline">Fix sync</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Is this play in the wrong place? Find where it happens.</TooltipContent>
          </Tooltip>
        )}
        {labelButton(
          <Button variant="outline" size="sm" aria-label="Label this play">
            <Tag />
            Label
            <Kbd className="ml-0.5 hidden h-4 min-w-4 text-caption @min-[600px]/now:inline-flex">G</Kbd>
          </Button>,
        )}
        {collect === "none" ? (
          <Button ref={addRef} size="sm" onClick={onAdd} aria-label={targetName ? `Add this play to ${targetName}` : "Add this play to a playlist"}>
            <Plus />
            Add
            <Kbd className="ml-0.5 hidden h-4 min-w-4 border-white/25 bg-white/15 text-caption text-primary-foreground @min-[600px]/now:inline-flex">A</Kbd>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled aria-label={`In ${targetName ?? "the playlist"}`}>
            <Check />
            {collect === "added" ? "Added" : (inLabel ?? "In playlist")}
          </Button>
        )}
      </span>
    </div>
  );
}
