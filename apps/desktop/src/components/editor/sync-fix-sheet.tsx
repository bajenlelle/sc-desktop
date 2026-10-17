/**
 * Fix sync from a clip, where the coach notices the drift: find where the
 * play really happens, then choose how far the move reaches. "This quarter"
 * moves the clip's quarter and every later quarter that follows it (a video
 * that skips the breaks drifts quarter by quarter); "Whole game" moves every
 * quarter; "Just this clip" moves this clip alone, as its own offsets.
 */
import * as React from "react";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { eventLabel, formatGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { describePeriodSyncs, projectedSync, shiftPeriod, shiftWholeGame, videoLooksCut } from "@scoutable/shared/lib/period-sync";
import { formatSpan } from "@/components/quarter-sync";
import { SyncPointPicker, type SeekRequest } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";

export type SyncFixScope = "quarter" | "game" | "clip";

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
  onApply,
  onCancel,
}: {
  match: StoredMatch;
  event: PlayByPlayEvent;
  videoDuration: number | null;
  /** `next` is the game's new sync, or null for "Just this clip". */
  onApply: (scope: SyncFixScope, next: SyncPoint | null, deltaSeconds: number) => Promise<void>;
  onCancel: () => void;
}) {
  const sync = match.syncPoint!;
  const mapped = computeVideoTime(event, sync);
  const ownPeriod = event.period >= 2 && !!sync.periods?.[String(event.period)];
  // A video that skips the breaks: open where the play should be, not where Q1's sync puts it.
  const looksCut = sync.breaksCut ?? videoLooksCut({ durationSeconds: videoDuration, events: match.events, sync }).cut;
  const start = looksCut && !ownPeriod ? (computeVideoTime(event, projectedSync(sync, match.events)) ?? mapped) : mapped;
  const [seek] = React.useState<SeekRequest | null>(() =>
    start !== null ? { seconds: Math.max(0, start - 3), nonce: Date.now() } : null,
  );
  const [found, setFound] = React.useState<number | null>(null);
  const [scope, setScope] = React.useState<SyncFixScope>("quarter");
  const [saving, setSaving] = React.useState(false);

  const delta = found !== null && mapped !== null ? found - mapped : null;
  const moves = delta !== null && Math.abs(delta) >= 0.05;
  const quarters = quartersMoved(sync, match.events, event.period);

  const explanation = !moves
    ? found === null
      ? "Set where the play happens to see what moves."
      : "That's where the play already is: nothing moves."
    : scope === "quarter"
      ? `${joinNames(quarters)} ${quarters.length === 1 ? "moves" : "move"} ${describeShift(delta!)}.`
      : scope === "game"
        ? `Every quarter moves ${describeShift(delta!)}.`
        : `This clip moves ${describeShift(delta!)}. The rest of the game stays.`;

  const applyLabel = scope === "quarter" ? `Move ${joinNames(quarters)}` : scope === "game" ? "Move the whole game" : "Move this clip";

  async function apply() {
    if (!moves || delta === null) return;
    const next =
      scope === "quarter"
        ? { ...shiftPeriod(sync, match.events, event.period, delta), ...(event.period >= 2 ? { breaksCut: true } : {}) }
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-separator px-5 py-4">
        <SheetTitle>Fix sync</SheetTitle>
        <SheetDescription>
          {match.title}. The play-by-play puts this play somewhere else in the video: find it, then set it.
        </SheetDescription>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <SyncPointPicker
          videoPath={match.videoUrl!}
          anchorDetail={describePlay(event)}
          copy={{
            title: "Find the play",
            instruction: "Scrub to the moment it happens, then set it.",
            button: "This is the play",
            confirmed: "Play at",
          }}
          note={null}
          confirmedSeconds={found}
          seekRequest={seek}
          onConfirm={setFound}
        />
        <div className="space-y-2">
          <SegmentedControl<SyncFixScope>
            aria-label="Apply to"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "quarter", label: "This quarter" },
              { value: "game", label: "Whole game" },
              { value: "clip", label: "Just this clip" },
            ]}
          />
          <p className="text-callout text-muted-foreground" aria-live="polite">
            {explanation}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-separator px-5 py-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!moves || saving} onClick={() => void apply()}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
