import type { ReactNode } from "react";
import { Timer } from "lucide-react";
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
    if (mode.purpose === "jump") {
      return {
        label: mode.partName,
        change,
        main: cue.sentence,
        hint: `${mode.first ? "The video jumps where the stream dropped: is the game still in step after it? " : ""}${
          change ? `Right if the ball goes in as the score over the video turns ${change.after}, give or take a second.` : "Right if it happens as its name lights up over the video, give or take a second."
        }`,
      };
    }
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
  if (mode.kind === "find" && mode.jumpAt !== undefined) {
    return {
      label: "After the jump",
      change,
      main: cue.sentence,
      hint: change
        ? `Scrub to where the ball goes in and the score becomes ${change.after}: likely earlier, by what the stream lost.`
        : "Scrub to where it happens: likely earlier, by what the stream lost.",
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

/** What the coach is doing, for the mode's badge: the whole of it, not the step (that is the label beside it). */
function modeTitle(sync: GameSync): string {
  const { mode } = sync;
  if (mode.kind === "ask") return mode.purpose === "jump" ? "Checking the jumps" : mode.purpose === "narrow" ? "Finding where it starts" : "Checking sync";
  if (mode.kind === "find") {
    if (mode.jumpAt !== undefined) return "Checking the jumps";
    if (mode.narrow) return "Finding where it starts";
    return mode.origin === "check" ? "Checking sync" : "Fixing sync";
  }
  return "Fixing sync";
}

/**
 * The sync's mode, over the footage, while a play is checked, found or fixed
 * (docs/game-view.md, "Sync"): it reads as a mode and not as playback (NN/g on
 * mode slips: a strong signal, the mode named, the way out in view). A tinted
 * panel with the mode's name, the step, the play and the answers, and Done;
 * under them, in full, what to do. It takes the Now bar's room under the
 * footage, which is free while it shows, and a little more.
 */
export function GameSyncBar({ sync, links }: { sync: GameSync; links?: ReactNode }) {
  const { mode, actions, busy } = sync;
  const words = syncWords(sync);
  if (mode.kind === "idle" || !words) return null;

  let buttons: ReactNode;
  if (mode.kind === "ask") {
    buttons = (
      <>
        {mode.purpose !== "narrow" ? (
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
    // Done, the panel's own, leaves it as the play stands.
    buttons = (
      <>
        <Button size="sm" onClick={actions.checkEarlier}>
          Check earlier plays
          <ReturnKey />
        </Button>
      </>
    );
  }

  const done = (
    <Button variant="ghost" size="sm" onClick={() => void actions.exit()} disabled={busy}>
      Done
    </Button>
  );

  return (
    <div
      role="group"
      aria-label="Sync"
      data-sync-mode={mode.kind}
      data-clip-start={sync.clip?.start.toFixed(2)}
      data-clip-end={sync.clip?.end.toFixed(2)}
      className="mb-3 shrink-0 rounded-xl bg-primary/8 px-3 pt-1.5 pb-2 ring-1 ring-primary/30"
    >
      <div className="flex h-9 items-center gap-2.5">
        <span
          data-sync="mode-title"
          title={modeTitle(sync)}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2 text-footnote font-semibold text-primary-foreground"
        >
          <Timer className="size-3.5" aria-hidden />
          <span className="hidden @min-[560px]/player:inline">{modeTitle(sync)}</span>
        </span>
        {/* How far the play moved is the bar's news; every other label gives way in a narrow column, to the line
            below, so the play keeps its words. */}
        <span data-sync="label" className={cn("shrink-0 text-callout font-medium text-foreground nums", mode.kind !== "confirm" && "hidden @min-[600px]/player:inline")}>
          {words.label}
        </span>
        {/* What to look for on the video's own scoreboard, ahead of the sentence: in a narrow bar the sentence gives way, not this. */}
        {words.change && (
          <span data-sync="change" aria-label={`${words.change.before} becomes ${words.change.after}`} className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-background/70 px-1.5 text-callout font-semibold nums">
            <span className="font-medium text-muted-foreground">{words.change.before}</span>
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
            {words.change.after}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">{buttons}</span>
        {/* The way out of the mode, always in the same place: what was answered is kept. In a narrow column it
            ends the line below, so the answers keep their room here. */}
        <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-separator @min-[600px]/player:block" aria-hidden />
        <span className="hidden shrink-0 @min-[600px]/player:inline-flex">{done}</span>
      </div>
      {/* What to do, in full and in the text's own colour: two lines are kept for it so the footage doesn't move. */}
      <div className="mt-0.5 flex h-10 items-start gap-3 text-callout">
        {mode.kind !== "confirm" && <span className="shrink-0 font-medium text-foreground @min-[600px]/player:hidden">{words.label}</span>}
        {/* The play first, in full (it is what to look for), then what to do. */}
        <p className="line-clamp-2 min-w-0 flex-1" title={`${words.main} ${words.hint}`.trim()}>
          <span data-sync="main" aria-live="polite" className="font-medium text-foreground">
            {words.main}
          </span>{" "}
          <span data-sync="hint" className="text-foreground/75">
            {words.hint}
          </span>
        </p>
        {links && <span className="flex shrink-0 items-center gap-3">{links}</span>}
        <span className="-mt-1 shrink-0 @min-[600px]/player:hidden">{done}</span>
      </div>
    </div>
  );
}
