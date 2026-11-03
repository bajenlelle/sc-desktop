/**
 * Fix sync from a clip, where the coach notices the drift: find where the
 * play really happens, then say which clips are off. That answer is how far
 * the move reaches. "Only this clip" moves this clip alone, as its own
 * offsets; "From this play on" moves this play and every later one up to the
 * next quarter with its own sync (a jump in the video); "This quarter"
 * moves the clip's quarter and every later quarter that follows it, i.e.
 * has no start of its own (a video that skips the breaks drifts quarter by
 * quarter); "The whole game"
 * moves every quarter (the tip-off is off). Nothing is chosen for the coach,
 * unless the sheet was opened with evidence (the skips-the-breaks banner).
 */
import * as React from "react";
import { X } from "lucide-react";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { describePlay, periodLabel, playClock } from "@scoutable/shared/lib/events";
import { nextFixAfter, projectedSync, shiftPeriod, shiftWholeGame, syncFromPlayOn } from "@scoutable/shared/lib/period-sync";
import { joinNames, pickPeekPlays, quartersMoved, syncReach, type SyncFixScope } from "@scoutable/shared/lib/sync-reach";
import { SyncReachStrip } from "@/components/editor/sync-reach-strip";
import { formatSpan } from "@/components/quarter-sync";
import { SyncHelpPopover } from "@/components/sync-help-popover";
import { SyncPointPicker, type SeekRequest } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { trackEvent } from "@/lib/analytics";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

/** "4 s later", "11:02 earlier". */
export function describeShift(deltaSeconds: number): string {
  const a = Math.abs(deltaSeconds);
  const amount = a < 60 ? `${Math.round(a * 10) / 10} s` : formatSpan(a);
  return `${amount} ${deltaSeconds < 0 ? "earlier" : "later"}`;
}

export function SyncFixPanel({
  match,
  event,
  videoDuration,
  leadSeconds,
  initialScope,
  reason,
  otherPlays,
  onApply,
  onCancel,
}: {
  match: StoredMatch;
  event: PlayByPlayEvent;
  videoDuration: number | null;
  /** How long before the play the clip starts: "From this play on" moves from there. */
  leadSeconds: number;
  /** A choice made for the coach, only when something points to it (the banner). */
  initialScope?: SyncFixScope;
  /** Why that choice was made, shown under the heading. */
  reason?: string;
  /**
   * The playlist's other plays of this game, each with how long before the
   * play its clip starts: the coach can watch one per quarter, as a player
   * would, to see where the drift starts.
   */
  otherPlays?: Array<PlayByPlayEvent & { leadSeconds: number }>;
  /** `next` is the game's new sync, or null for "Only this clip". */
  onApply: (scope: SyncFixScope, next: SyncPoint | null, deltaSeconds: number) => Promise<void>;
  onCancel: () => void;
}) {
  const sync = match.syncPoint!;
  const mapped = computeVideoTime(event, sync);
  // Open where the play is set now, so the coach starts from what the clip
  // shows. Only when that spot isn't in the video at all (a later quarter of
  // a video that skips the breaks can land past its end) open where the play
  // should be instead.
  const inVideo = mapped !== null && mapped >= 0 && (videoDuration === null || mapped < videoDuration);
  const start = inVideo ? mapped : (computeVideoTime(event, projectedSync(sync, match.events)) ?? mapped);
  const [seek, setSeek] = React.useState<SeekRequest | null>(() =>
    start !== null ? { seconds: Math.max(0, start), nonce: Date.now() } : null,
  );
  const [found, setFound] = React.useState<number | null>(null);
  /** The other quarter's play the footage is showing, while the coach checks it: its clock, its words, its quarter and where its clip starts. */
  const [peek, setPeek] = React.useState<{ label: string; cue: string; name: string; at: number } | null>(null);
  const peekPlays = React.useMemo(() => pickPeekPlays(event, otherPlays ?? []), [event, otherPlays]);
  const [scope, setScope] = React.useState<SyncFixScope | null>(initialScope ?? null);
  const [saving, setSaving] = React.useState(false);
  /** The sheet is a dialog: the picker's keys (Space, ←/→, ,/.) belong to all of it. */
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The sheet itself holds the focus when it opens, not its first button
  // (−10s), so Space plays and pauses from the start.
  React.useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const delta = found !== null && mapped !== null ? found - mapped : null;
  const moves = delta !== null && Math.abs(delta) >= 0.05;
  const quarters = quartersMoved(sync, match.events, event.period);
  const stopsAt = event.realWorldTime ? nextFixAfter(sync, { realWorldTime: event.realWorldTime, period: event.period }) : null;
  /** Where a move from this play stops: the next quarter with its own sync, or the next fix. */
  const upTo = stopsAt?.kind === "period" ? `, up to ${periodLabel(stopsAt.period)}` : stopsAt?.kind === "cut" ? ", up to the next fix" : "";
  // "This quarter" on Q2 or later also answers "does the video skip the breaks?".
  const marksBreaksCut = event.period >= 2 && sync.breaksCut !== true;
  const reach = React.useMemo(() => syncReach(sync, match.events, event, scope), [sync, match.events, event, scope]);
  const scopeHeadingId = React.useId();

  const explanation = !moves
    ? found === null
      ? "Set where the play happens to see what moves."
      : "That's where the play already is: nothing moves."
    : scope === null
      ? "Choose which clips are off."
      : scope === "quarter"
        ? `${joinNames(quarters)} ${quarters.length === 1 ? "moves" : "move"} ${describeShift(delta!)}.${marksBreaksCut ? " This also marks the video as skipping the breaks." : ""}`
        : scope === "play"
          ? `This play and every later play move ${describeShift(delta!)}${upTo}. Earlier plays stay.`
          : scope === "game"
            ? `Every quarter moves ${describeShift(delta!)}.`
            : `This clip moves ${describeShift(delta!)}. The rest of the game stays.`;

  const applyLabel =
    scope === "quarter"
      ? `Move ${joinNames(quarters)}`
      : scope === "play"
        ? "Move from this play on"
        : scope === "game"
          ? "Move the whole game"
          : scope === "clip"
            ? "Move this clip"
            : "Move";

  // Looking at another quarter's play plays its clip from where it starts,
  // as a player would see it: the question is whether the play comes within
  // it. The play being fixed stays the one this sheet opened on, and it
  // can't be set from there. Scrubbing well away ends the look (the coach is
  // finding the play again); stepping around the clip keeps it. The focus
  // goes back to the sheet so the keys keep working after a button that just
  // went away (WebView2 focuses a clicked button; WebKit doesn't).
  const refocus = () => rootRef.current?.focus({ preventScroll: true });
  function peekAt(play: PlayByPlayEvent & { leadSeconds: number }) {
    const t = computeVideoTime(play, sync);
    if (t === null) return;
    const at = Math.max(0, t - play.leadSeconds);
    setSeek({ seconds: at, nonce: Date.now(), play: true });
    setPeek({ label: playClock(play), cue: describePlay(play), name: periodLabel(play.period), at });
    trackEvent("sync_fix_peeked", { period: play.period });
    refocus();
  }
  function backToPlay() {
    const to = found ?? start;
    if (to !== null) setSeek({ seconds: Math.max(0, to), nonce: Date.now(), play: false });
    setPeek(null);
    refocus();
  }
  function scrubbedTo(seconds: number) {
    if (peek && Math.abs(seconds - peek.at) > 30) setPeek(null);
  }
  function confirm(seconds: number) {
    setFound(seconds);
    refocus();
  }

  async function apply() {
    if (!moves || delta === null || scope === null) return;
    const next =
      scope === "quarter"
        ? { ...shiftPeriod(sync, match.events, event.period, delta), ...(event.period >= 2 ? { breaksCut: true } : {}) }
        : scope === "play" && event.realWorldTime && found !== null
          ? syncFromPlayOn(sync, { realWorldTime: event.realWorldTime, period: event.period, eventId: event.eventId }, found, leadSeconds)
          : scope === "game"
            ? shiftWholeGame(sync, delta)
            : null;
    setSaving(true);
    try {
      await onApply(scope, next, delta);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <SheetTitle>Fix sync</SheetTitle>
          <SheetDescription className="truncate">{match.title}</SheetDescription>
        </div>
        <SyncHelpPopover />
        <SheetClose
          aria-label="Close"
          className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <X className="size-3.5" />
        </SheetClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <SyncPointPicker
          layout="split"
          videoPath={match.videoUrl!}
          copy={{
            title: "Find the play",
            instruction: "Scrub to the moment it happens, then set it. The video starts where Scoutable has this play now.",
            button: "This is the play",
            confirmed: "Play at",
          }}
          note={
            peek
              ? `Looking at ${peek.label} on the game clock: ${peek.cue}.`
              : `Look for ${playClock(event)} on the game clock: ${describePlay(event)}.`
          }
          noteExtra={
            peekPlays.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                {peek ? (
                  <>
                    <p>
                      Playing from where that clip starts. If the play comes within a few seconds, {peek.name} is fine and
                      the problem starts later. If it's nowhere near, {peek.name} is off too.
                    </p>
                    <Button size="xs" variant="outline" onClick={backToPlay}>
                      Back to {playClock(event)}
                    </Button>
                  </>
                ) : (
                  <>
                    <span>Not sure which? Watch a play from another quarter:</span>
                    {peekPlays.map((p) => {
                      const placed = computeVideoTime(p, sync) !== null;
                      return (
                        <Button
                          key={p.eventId}
                          size="xs"
                          variant="outline"
                          disabled={!placed}
                          title={placed ? undefined : "This play can't be placed"}
                          onClick={() => peekAt(p)}
                        >
                          {playClock(p)}
                        </Button>
                      );
                    })}
                  </>
                )}
              </div>
            ) : undefined
          }
          confirmDisabledReason={peek ? `Go back to ${playClock(event)} before setting it` : undefined}
          onScrub={scrubbedTo}
          confirmedSeconds={found}
          seekRequest={seek}
          onConfirm={confirm}
          keyContainer={rootRef}
          aside={
            <>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-separator pt-3">
                <div>
                  <p id={scopeHeadingId} className="text-headline text-foreground">
                    Which clips are off?
                  </p>
                  {reason && <p className="mt-0.5 text-callout text-muted-foreground">{reason}</p>}
                </div>
                <RadioGroup<SyncFixScope>
                  aria-labelledby={scopeHeadingId}
                  value={scope}
                  onValueChange={setScope}
                  options={[
                    { value: "clip", label: "Only this clip", detail: "the rest of the game is fine" },
                    { value: "play", label: "From this play on", detail: "the video jumps here" },
                    // Cut breaks can't put a Q1 play off: for Q1 the quarter-wide move is the whole game.
                    ...(event.period >= 2
                      ? [{ value: "quarter" as const, label: "This quarter", detail: `${joinNames(quarters)} · the video skips the breaks` }]
                      : []),
                    { value: "game", label: "The whole game", detail: "the tip-off is off" },
                  ]}
                />
                <SyncReachStrip reach={reach} tick={scope === "clip" ? "clip" : "play"} caption={explanation} className="pt-1" />
              </div>
              <div className="flex shrink-0 justify-end gap-2 pt-3">
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button disabled={!moves || scope === null || saving} onClick={() => void apply()}>
                  {applyLabel}
                </Button>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
