/**
 * Fix sync from a clip, where the coach notices the drift: find where the
 * play really happens, then choose how far the move reaches. "This quarter"
 * moves the clip's quarter and every later quarter that follows it (a video
 * that skips the breaks drifts quarter by quarter); "From this play on" moves
 * this play and every later one up to the next quarter with its own sync (a
 * cut inside a quarter); "Whole game" moves every quarter; "Just this clip"
 * moves this clip alone, as its own offsets.
 */
import * as React from "react";
import { X } from "lucide-react";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import {
  describePeriodSyncs,
  nextFixAfter,
  projectedSync,
  shiftPeriod,
  shiftWholeGame,
  syncFromPlayOn,
} from "@scoutable/shared/lib/period-sync";
import { formatSpan } from "@/components/quarter-sync";
import { SyncPointPicker, type SeekRequest } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

export type SyncFixScope = "quarter" | "play" | "game" | "clip";

/** "Q3", "Q3 and Q4", "Q2, Q3 and Q4". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "4 s later", "11:02 earlier". */
export function describeShift(deltaSeconds: number): string {
  const a = Math.abs(deltaSeconds);
  const amount = a < 60 ? `${Math.round(a * 10) / 10} s` : formatSpan(a);
  return `${amount} ${deltaSeconds < 0 ? "earlier" : "later"}`;
}

/** The play in words a coach can spot: "#7 Ida Andersson · 3PT Made · Q3 7:42". */
export function describePlay(event: PlayByPlayEvent): string {
  const who = event.player
    ? `${event.player.pno ? `#${event.player.pno} ` : ""}${playerName(event)}`
    : (event.eventTeam?.teamName ?? "");
  const clock = event.gameClockTime ? formatGameClock(event.gameClockTime) : "";
  return [who, eventLabel(event), `${periodLabel(event.period)}${clock ? ` ${clock}` : ""}`].filter(Boolean).join(" · ");
}

/** The quarters "This quarter" moves: the play's, and every later one that follows it. */
export function quartersMoved(sync: SyncPoint, events: PlayByPlayEvent[], period: number): string[] {
  const names = [periodLabel(period)];
  for (const row of describePeriodSyncs(sync, events)) {
    if (row.period <= period) continue;
    if (row.set) break;
    names.push(row.name);
  }
  return names;
}

export function SyncFixPanel({
  match,
  event,
  videoDuration,
  leadSeconds,
  onApply,
  onCancel,
}: {
  match: StoredMatch;
  event: PlayByPlayEvent;
  videoDuration: number | null;
  /** How long before the play the clip starts: "From this play on" moves from there. */
  leadSeconds: number;
  /** `next` is the game's new sync, or null for "Just this clip". */
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
  const [seek] = React.useState<SeekRequest | null>(() =>
    start !== null ? { seconds: Math.max(0, start), nonce: Date.now() } : null,
  );
  const [found, setFound] = React.useState<number | null>(null);
  const [scope, setScope] = React.useState<SyncFixScope>("quarter");
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
  const playDetail = stopsAt?.kind === "period" ? `up to ${periodLabel(stopsAt.period)}` : stopsAt?.kind === "cut" ? "up to the next fix" : undefined;
  const upTo = playDetail ? `, ${playDetail}` : "";
  const scopeHeadingId = React.useId();

  const explanation = !moves
    ? found === null
      ? "Set where the play happens to see what moves."
      : "That's where the play already is: nothing moves."
    : scope === "quarter"
      ? `${joinNames(quarters)} ${quarters.length === 1 ? "moves" : "move"} ${describeShift(delta!)}.`
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
          : "Move this clip";

  async function apply() {
    if (!moves || delta === null) return;
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
            instruction: "Scrub to the moment it happens, then set it.",
            button: "This is the play",
            confirmed: "Play at",
          }}
          // Each "·" sticks to the word before it, so a line never starts with one.
          note={`Look for ${describePlay(event).replaceAll(" · ", " · ")}.`}
          confirmedSeconds={found}
          seekRequest={seek}
          onConfirm={setFound}
          keyContainer={rootRef}
          aside={
            <>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-separator pt-3">
                <p id={scopeHeadingId} className="text-headline text-foreground">
                  Apply to
                </p>
                <RadioGroup<SyncFixScope>
                  aria-labelledby={scopeHeadingId}
                  value={scope}
                  onValueChange={setScope}
                  options={[
                    { value: "quarter", label: "This quarter", detail: joinNames(quarters) },
                    { value: "play", label: "From this play on", detail: playDetail },
                    { value: "game", label: "Whole game" },
                    { value: "clip", label: "Just this clip" },
                  ]}
                />
                <p className="text-callout text-muted-foreground" aria-live="polite">
                  {explanation}
                </p>
              </div>
              <div className="flex shrink-0 justify-end gap-2 pt-3">
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button disabled={!moves || saving} onClick={() => void apply()}>
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
