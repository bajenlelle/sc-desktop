"use client";

/**
 * Fix sync from a clip, where the coach notices the drift: the desktop's
 * components/editor/sync-fix-sheet.tsx on the web. Find where the play really
 * happens in the game's video, then choose how far the move reaches: "This
 * quarter" moves the clip's quarter and every later quarter that follows it
 * (a video that skips the breaks drifts quarter by quarter), "Whole game"
 * moves every quarter, "Just this clip" moves this clip alone as its own
 * offsets (shown only when the editor passes `onClipNudge`).
 *
 * Self-contained: the sheet plays the game from the viewer's cloud copy in
 * its own picker (the editor's player can't be scrubbed frame by frame from
 * here) and writes the sync itself: `sync_periods_set` for a quarter, or for
 * the whole game when it has quarters of its own (one write with the
 * tip-off), `sync_set` for the tip-off alone. The server re-cuts the shared
 * clips the move reaches and moves their pans. A dialog; a bottom sheet on
 * phones.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { setGameVideoPeriods, setGameVideoSync } from "@scoutable/shared/lib/game-video-client";
import { parseSyncPeriodsPayload, syncPeriodsPayloadOf } from "@scoutable/shared/lib/game-video-wire";
import { normalizeSyncPoint, projectedSync, quartersMoved, shiftPeriod, shiftWholeGame } from "@scoutable/shared/lib/period-sync";
import type { PlayByPlayEvent, StoredMatch, SyncPoint } from "@scoutable/shared/types/match";
import { readSyncPoint, syncWriteError } from "@/components/game/game-sync-panel";
import { SyncPicker } from "@/components/game/sync-picker";
import { describePlay, describeShift, joinNames } from "@/components/sync/sync-words";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { trackEvent } from "@/lib/analytics";
import { fetchPlayUrl } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

export type SyncFixScope = "quarter" | "game" | "clip";

export interface FixSyncSheetProps {
  open: boolean;
  onClose: () => void;
  /** The clip's game with its sync point (a game without one has nothing to fix yet). */
  match: StoredMatch;
  /** The game's play-by-play (the editor's light matches carry none). */
  events: PlayByPlayEvent[];
  /** Which play the clip is. */
  clip: { matchId: string; eventId: number };
  /** The viewer's ready cloud copy of the game (game_videos.id): only its uploader may move the sync. */
  videoId: string;
  /**
   * Seeks the editor's player, in seconds of the game's video. Called once
   * after a fix lands, with where the play now is, so the editor can show
   * the clip at its new place.
   */
  play: (seconds: number) => void;
  /** The game's sync after a quarter or whole-game fix: the editor re-derives its windows from it. */
  onApplied: (nextSync: SyncPoint) => void;
  /**
   * "Just this clip": move this clip's window by `deltaSeconds` (later when
   * positive), i.e. its offsets become pre − Δ and post + Δ. The option is
   * shown only when this is given; a rejected promise keeps the sheet open.
   */
  onClipNudge?: (deltaSeconds: number) => void | Promise<void>;
  /** Where the sheet was opened from (sync_fix_opened). */
  entry?: "clip_menu" | "this_clip" | "hint";
}

export function FixSyncSheet(props: FixSyncSheetProps) {
  const { open, onClose, clip, entry } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Every opening starts fresh; the body stays while the sheet leaves, so it
  // leaves the way it came instead of emptying first.
  const [lastOpen, setLastOpen] = useState(open);
  const [session, setSession] = useState(open ? 1 : 0);
  const [mounted, setMounted] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSession((s) => s + 1);
      setMounted(true);
    }
  }

  useEffect(() => {
    if (open) trackEvent("sync_fix_opened", { entry: entry ?? "clip_menu", origin: "web" });
    // Once per opening, not per re-render of the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="sm:max-w-3xl"
        showCloseButton={false}
        onExitComplete={() => setMounted(false)}
        // The sheet itself holds the focus, not its first button (−10s), so Space plays and pauses from the start.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          rootRef.current?.focus({ preventScroll: true });
        }}
      >
        <div ref={rootRef} tabIndex={-1} className="flex min-w-0 flex-col gap-4 outline-none">
          {mounted && <FixSyncBody key={`${session}:${clip.matchId}:${clip.eventId}`} {...props} keyContainer={rootRef} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FixSyncBody({
  onClose,
  match,
  events,
  clip,
  videoId,
  play,
  onApplied,
  onClipNudge,
  keyContainer,
}: FixSyncSheetProps & { keyContainer: React.RefObject<HTMLElement | null> }) {
  const event = useMemo(() => events.find((e) => e.eventId === clip.eventId) ?? null, [events, clip.eventId]);
  const sync = useMemo(() => (match.syncPoint && typeof match.syncPoint.syncVideoTime === "number" ? normalizeSyncPoint(match.syncPoint) : null), [match.syncPoint]);

  // The game's video, from the viewer's own cloud copy (the editor has usually signed it already).
  const [video, setVideo] = useState<{ url: string; duration: number | null } | "missing" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchPlayUrl(clip.matchId).then((r) => {
      if (!cancelled) setVideo(r ? { url: r.url, duration: r.durationSeconds } : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [clip.matchId]);

  const [found, setFound] = useState<number | null>(null);
  const [scope, setScope] = useState<SyncFixScope>("quarter");
  const [saving, setSaving] = useState(false);

  const mapped = event && sync ? computeVideoTime(event, sync) : null;
  const duration = video && video !== "missing" ? video.duration : null;
  // Open where the play is set now, so the coach starts from what the clip
  // shows. Only when that spot isn't in the video at all (a later quarter of
  // a video that skips the breaks can land past its end) open where the play
  // should be instead.
  const start = useMemo(() => {
    if (!event || !sync) return null;
    const inVideo = mapped !== null && mapped >= 0 && (duration === null || mapped < duration);
    return inVideo ? mapped : (computeVideoTime(event, projectedSync(sync, events)) ?? mapped);
  }, [event, sync, events, mapped, duration]);

  const header = (
    <DialogHeader>
      <DialogTitle>Fix sync</DialogTitle>
      <DialogDescription>{match.title}. The play-by-play puts this play somewhere else in the video: find it, then set it.</DialogDescription>
    </DialogHeader>
  );

  if (!sync || !event) {
    return (
      <>
        {header}
        <Callout>
          {!sync ? (
            <>
              This game has no sync yet.{" "}
              <Link href={`/library/${encodeURIComponent(clip.matchId)}`} className="font-medium text-primary hover:underline">
                Set its tip-off on the game&apos;s page
              </Link>
              .
            </>
          ) : (
            "This play isn't in the game's play-by-play any more."
          )}
        </Callout>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  const delta = found !== null && mapped !== null ? found - mapped : null;
  const moves = delta !== null && Math.abs(delta) >= 0.05;
  const quarters = quartersMoved(sync, events, event.period);
  const scopeShown: SyncFixScope = scope === "clip" && !onClipNudge ? "quarter" : scope;

  const explanation = !moves
    ? found === null
      ? "Set where the play happens to see what moves."
      : "That's where the play already is: nothing moves."
    : scopeShown === "quarter"
      ? `${joinNames(quarters)} ${quarters.length === 1 ? "moves" : "move"} ${describeShift(delta!)}.`
      : scopeShown === "game"
        ? `Every quarter moves ${describeShift(delta!)}.`
        : `This clip moves ${describeShift(delta!)}. The rest of the game stays.`;
  const applyLabel = scopeShown === "quarter" ? `Move ${joinNames(quarters)}` : scopeShown === "game" ? "Move the whole game" : "Move this clip";

  /** The quarters (and with `withTipoff` the tip-off) in one write; null when it didn't land. */
  async function writePeriods(next: SyncPoint, withTipoff: boolean): Promise<SyncPoint | null> {
    const payload = syncPeriodsPayloadOf(next, { withTipoff });
    if (!parseSyncPeriodsPayload(payload)) {
      toast.error("That moves a quarter outside the video", { description: "Set where the play happens again." });
      return null;
    }
    const result = await setGameVideoPeriods(createClient(), { videoId, syncPoint: payload });
    if (!result.ok) {
      const copy = syncWriteError(result.error);
      toast.error(copy.title, { description: copy.description });
      return null;
    }
    return normalizeSyncPoint(result.data.syncPoint as unknown as SyncPoint);
  }

  /** The tip-off alone, as the uploader's own; null when it didn't land. */
  async function writeTipoff(seconds: number): Promise<SyncPoint | null> {
    const result = await setGameVideoSync(createClient(), { videoId, status: "manual", seconds });
    if (!result.ok) {
      const copy = syncWriteError(result.error);
      toast.error(copy.title, { description: copy.description });
      return null;
    }
    return (await readSyncPoint(match.id)) ?? { ...sync!, syncVideoTime: result.data.seconds };
  }

  async function apply() {
    if (!moves || delta === null || found === null || saving || !sync || !event) return;
    setSaving(true);
    try {
      if (scopeShown === "clip") {
        try {
          await onClipNudge!(delta);
        } catch {
          toast.error("Couldn't move the clip", { description: "Try again in a moment." });
          return;
        }
        toast.success(`This clip moved ${describeShift(delta)}`);
      } else {
        const ownQuarters = !!sync.periods && Object.keys(sync.periods).length > 0;
        const next =
          scopeShown === "quarter" && event.period >= 2
            ? await writePeriods({ ...shiftPeriod(sync, events, event.period, delta), breaksCut: true }, false)
            : scopeShown === "game" && ownQuarters
              ? await writePeriods(shiftWholeGame(sync, delta), true)
              : // The tip-off alone: the play is in Q1, or the game has no quarter syncs of its own.
                await writeTipoff(sync.syncVideoTime + delta);
        if (!next) return;
        onApplied(next);
        toast.success(scopeShown === "quarter" ? `${joinNames(quarters)} moved ${describeShift(delta)}` : `The whole game moved ${describeShift(delta)}`);
      }
      trackEvent("sync_fix_applied", { scope: scopeShown, period: event.period, delta_s: Math.round(delta * 10) / 10, origin: "web" });
      play(found);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {header}
      {video === null ? (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-fill-1">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : video === "missing" ? (
        <Callout tone="warning">
          This game&apos;s video isn&apos;t one of your cloud copies, so its sync can only be fixed by the person who uploaded it.
        </Callout>
      ) : (
        <SyncPicker
          src={video.url}
          onSourceStale={() => fetchPlayUrl(clip.matchId, { force: true }).then((r) => r?.url ?? null)}
          anchorDetail={describePlay(event)}
          copy={{ title: "Find the play", instruction: "Scrub to the moment it happens, then set it.", button: "This is the play", confirmed: "Play at" }}
          note={null}
          initialSeconds={start !== null ? Math.max(0, start) : null}
          confirmedSeconds={found}
          onConfirm={setFound}
          keyContainer={keyContainer}
        />
      )}
      <div className="space-y-2">
        <SegmentedControl<SyncFixScope>
          aria-label="Apply to"
          value={scopeShown}
          onValueChange={setScope}
          options={[
            { value: "quarter", label: "This quarter" },
            { value: "game", label: "Whole game" },
            ...(onClipNudge ? [{ value: "clip" as const, label: "Just this clip" }] : []),
          ]}
        />
        <p className="text-callout text-muted-foreground" aria-live="polite">
          {explanation}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!moves || saving || video === null || video === "missing"} onClick={() => void apply()}>
          {saving && <Loader2 className="animate-spin" />}
          {applyLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
