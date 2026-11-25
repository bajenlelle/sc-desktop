import type { ReactNode } from "react";
import { describeReach, describeShiftSeconds } from "@scoutable/shared/lib/sync-check";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { GameSync } from "./use-game-sync";

const score = (s: { home: number; away: number }) => `${s.home}–${s.away}`;

/** The Return key on the bar's main button, as the Now bar shows A and G on its own. */
function ReturnKey() {
  return (
    <Kbd className="ml-0.5 hidden h-4 min-w-4 border-white/25 bg-white/15 text-caption text-primary-foreground @min-[600px]/player:inline-flex" aria-hidden>
      ⏎
    </Kbd>
  );
}

/**
 * What the sync's mode says and asks, in the words the bar and the line
 * under the timeline show: a short label, the play's score change when it
 * has one (what to look for on the video's scoreboard), the play or the
 * outcome in a sentence, and what to do.
 */
export function syncWords(sync: GameSync): { label: string; change: { before: string; after: string } | null; main: string; hint: string } | null {
  const { mode, cue } = sync;
  if (mode.kind === "idle" || !cue) return null;
  const change = cue.score ? { before: score(cue.score.before), after: score(cue.score.after) } : null;
  if (mode.kind === "ask") {
    if (mode.purpose === "narrow" || !mode.part) {
      return {
        label: `Where it starts · ${mode.partName}`,
        change,
        main: cue.sentence,
        hint: "Is this earlier play right too? Each answer halves the plays left to look at.",
      };
    }
    return {
      label: mode.total > 1 ? `Check ${mode.part.index + 1} of ${mode.total} · ${mode.partName}` : `Check · ${mode.partName}`,
      change,
      main: cue.sentence,
      // The first play says what a check is: one play a part, and the sync stays as it is unless one is off.
      hint: `${mode.first ? (mode.total > 1 ? "One play from each part of the game. Nothing moves unless one is off. " : "Nothing moves unless the play is off. ") : ""}${
        change ? `Right if the ball goes in as the score over the video turns ${change.after}, give or take a second.` : "Right if it happens as its name lights up over the video, give or take a second."
      }`,
    };
  }
  if (mode.kind === "find" && mode.narrow) {
    return {
      label: `Where it starts · ${mode.narrow.partName}`,
      change,
      main: cue.sentence,
      hint: "The video is where this play should be if it moved with the others. If it isn’t here, scrub to where it happens.",
    };
  }
  if (mode.kind === "find") {
    return {
      label: "Find the play",
      change,
      main: cue.sentence,
      hint: change ? `Scrub to the moment the ball goes in and the score becomes ${change.after}. The arrow keys step a second.` : "Scrub to the moment it happens. The arrow keys step a second.",
    };
  }
  if (mode.kind === "confirm") {
    const shift = describeShiftSeconds(mode.found - mode.mapped);
    const n = mode.plan.reach.plays;
    const reach = describeReach(mode.plan.reach);
    const sentence = reach.charAt(0).toUpperCase() + reach.slice(1);
    // The bar says what moves in a few words; from where to where is on the line under the close-up.
    if (mode.suggested === "play") {
      return {
        label: shift,
        change: null,
        main: mode.event.loggedAt ? "Logged late, so only this play should move." : "A small shift is usually this play alone.",
        hint: n > 1 ? `Or move ${n} plays with it: ${reach}.` : "",
      };
    }
    return {
      label: shift,
      change: null,
      main: n > 1 ? `${n} plays move with it.` : "Only this play moves.",
      hint: n > 1 ? `${sentence}. Plays you’ve already checked stay where they are.` : "",
    };
  }
  return {
    label: "Moved",
    change: null,
    main: `Earlier plays in ${mode.narrow.partName} may be off too.`,
    hint: "A few quick looks at earlier plays find where the shift starts.",
  };
}

/**
 * The Now bar's place while the sync is being checked or fixed: what the
 * question is about, and the answers. The longer line of what to do is under
 * the timeline (`syncWords().hint`), where the game's facts otherwise are, so
 * the bar keeps the Now bar's height and the footage doesn't move.
 */
export function GameSyncBar({ sync }: { sync: GameSync }) {
  const { mode, actions, busy } = sync;
  const words = syncWords(sync);
  if (mode.kind === "idle" || !words) return null;

  let buttons: ReactNode;
  if (mode.kind === "ask") {
    buttons = (
      <>
        {mode.purpose === "check" ? (
          <Button variant="ghost" size="sm" onClick={actions.skip} disabled={busy}>
            Skip
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={actions.stop} disabled={busy}>
            Stop here
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={actions.itsOff} disabled={busy}>
          It’s off
        </Button>
        <Button size="sm" onClick={() => void actions.looksRight()} disabled={busy}>
          Looks right
          <ReturnKey />
        </Button>
      </>
    );
  } else if (mode.kind === "find") {
    buttons = (
      <>
        <Button variant="outline" size="sm" onClick={actions.cancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void actions.here()} disabled={busy}>
          The play is here
          <ReturnKey />
        </Button>
      </>
    );
  } else if (mode.kind === "confirm") {
    const n = mode.plan.reach.plays;
    const only = (primary: boolean) => (
      <Button key="only" variant={primary ? "default" : "outline"} size="sm" onClick={() => void actions.moveOnlyThis()} disabled={busy}>
        Only this play
        {primary && <ReturnKey />}
      </Button>
    );
    const on = (primary: boolean) =>
      n > 1 ? (
        <Button key="on" variant={primary ? "default" : "outline"} size="sm" onClick={() => void actions.moveOn()} disabled={busy}>
          Move {n} plays
          {primary && <ReturnKey />}
        </Button>
      ) : null;
    buttons = (
      <>
        <Button variant="ghost" size="sm" onClick={actions.back} disabled={busy}>
          Back
        </Button>
        {mode.suggested === "play" ? [on(false), only(true)] : [only(false), on(true)]}
      </>
    );
  } else {
    buttons = (
      <>
        <Button variant="outline" size="sm" onClick={actions.done}>
          Done
        </Button>
        <Button size="sm" onClick={actions.checkEarlier}>
          Check earlier plays
          <ReturnKey />
        </Button>
      </>
    );
  }

  return (
    <div role="group" aria-label="Sync" data-sync-mode={mode.kind} data-clip-start={sync.clip?.start.toFixed(2)} data-clip-end={sync.clip?.end.toFixed(2)} className="flex h-11 shrink-0 items-center gap-2.5 px-1">
      {/* How far the play moved is the bar's news; every other label gives way in a narrow column, to the line under
          the timeline (the game view repeats it there), so the play keeps its words. */}
      <span data-sync="label" className={cn("shrink-0 text-callout font-medium text-muted-foreground nums", mode.kind !== "confirm" && "hidden @min-[600px]/player:inline")}>
        {words.label}
      </span>
      {/* What to look for on the video's own scoreboard, ahead of the sentence: in a narrow bar the sentence gives way, not this. */}
      {words.change && (
        <span data-sync="change" aria-label={`${words.change.before} becomes ${words.change.after}`} className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-fill-2 px-1.5 text-callout font-semibold nums">
          <span className="font-medium text-muted-foreground">{words.change.before}</span>
          <span className="text-muted-foreground" aria-hidden>
            →
          </span>
          {words.change.after}
        </span>
      )}
      <span data-sync="main" title={words.main} aria-live="polite" className="min-w-0 flex-1 truncate text-callout font-medium">
        {words.main}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{buttons}</span>
    </div>
  );
}
