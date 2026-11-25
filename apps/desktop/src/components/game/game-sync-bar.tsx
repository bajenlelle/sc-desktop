import type { ReactNode } from "react";
import { describeReach, describeShiftSeconds } from "@scoutable/shared/lib/sync-check";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { GameSync } from "./use-game-sync";

const score = (s: { home: number; away: number }) => `${s.home}–${s.away}`;

/** The Return key on the bar's main button, as the Now bar shows A and G on its own. */
function ReturnKey() {
  return (
    <Kbd className="ml-0.5 hidden h-4 min-w-4 border-white/25 bg-white/15 text-caption text-primary-foreground @min-[560px]/sync:inline-flex" aria-hidden>
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
    if (mode.purpose === "narrow" && mode.narrow) {
      return {
        label: `Where it starts · ${mode.part.name}`,
        change,
        main: cue.sentence,
        hint: `Is this earlier play in the right place? If it’s off, it moves ${describeShiftSeconds(mode.narrow.delta)} too.`,
      };
    }
    return {
      label: mode.total > 1 ? `Check ${mode.part.index + 1} of ${mode.total} · ${mode.part.name}` : `Check · ${mode.part.name}`,
      change,
      main: cue.sentence,
      hint: change ? `Does the ball go in as the score above the video turns ${change.after}? A second either way is fine.` : "Does it happen as its name lights up above the video? A second either way is fine.",
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
    if (mode.suggested === "play") {
      return {
        label: shift,
        change: null,
        main: mode.event.loggedAt ? "This play was logged late, so only it should move." : "A shift this small is usually this play alone, logged a moment late.",
        hint: n > 1 ? `Or move ${n} plays with it: ${reach}.` : "",
      };
    }
    return {
      label: shift,
      change: null,
      main: n > 1 ? `${n} plays move with it: ${reach}.` : "Only this play moves.",
      hint: "Plays you’ve already checked stay where they are.",
    };
  }
  return {
    label: "Moved",
    change: null,
    main: `Earlier plays in ${mode.narrow.part.name} may be off too.`,
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
    <div role="group" aria-label="Sync" data-sync-mode={mode.kind} data-clip-start={sync.clip?.start.toFixed(2)} data-clip-end={sync.clip?.end.toFixed(2)} className="@container/sync flex h-11 shrink-0 items-center gap-2.5 px-1">
      <span data-sync="label" className="shrink-0 text-callout font-medium text-muted-foreground nums">
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
