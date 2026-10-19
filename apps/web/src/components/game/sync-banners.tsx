"use client";

import { useState } from "react";
import { Loader2, Scissors, TimerReset } from "lucide-react";
import { formatMSSd } from "@scoutable/shared/lib/clip-timing";
import { formatSpan } from "@/components/sync/sync-words";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";

/** A tip-off this close to the game's sync is the same tip-off. */
const SAME_TIPOFF_S = 0.3;

/**
 * The game's sync was set before this video existed (an earlier upload, or
 * the desktop's own file), and our converter couldn't confirm it fits: a
 * replaced video can start somewhere else. The uploader checks it once:
 * "Looks right" keeps it as their own sync for this video, "Use 0:12.0"
 * takes the tip-off the converter found, "Check" opens the picker.
 */
export function SyncBeforeVideoBanner({
  seconds,
  suggestedSeconds,
  onKeep,
  onCheck,
}: {
  /** The game's tip-off now, from its sync point. */
  seconds: number;
  /** Where the converter found the tip-off in this video, when it did. */
  suggestedSeconds: number | null;
  /** Saves `at` as the uploader's own tip-off for this video. */
  onKeep: (at: number) => Promise<void>;
  onCheck: () => void;
}) {
  const [busy, setBusy] = useState<"keep" | "use" | null>(null);
  const differs = suggestedSeconds !== null && Math.abs(suggestedSeconds - seconds) > SAME_TIPOFF_S;
  const run = async (which: "keep" | "use", at: number) => {
    setBusy(which);
    try {
      await onKeep(at);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Callout
      tone="warning"
      icon={<TimerReset />}
      className="mx-4 mb-3 sm:mx-6"
      action={
        <span className="flex flex-wrap justify-end gap-2">
          {differs ? (
            <Button size="sm" disabled={busy !== null} onClick={() => void run("use", suggestedSeconds!)}>
              {busy === "use" && <Loader2 className="animate-spin" />}
              Use <span className="nums">{formatMSSd(suggestedSeconds!)}</span>
            </Button>
          ) : (
            <Button size="sm" disabled={busy !== null} onClick={() => void run("keep", seconds)}>
              {busy === "keep" && <Loader2 className="animate-spin" />}
              Looks right
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={onCheck}>
            Check
          </Button>
        </span>
      }
    >
      {differs ? (
        <>
          We found the tip-off at <span className="nums font-medium">{formatMSSd(suggestedSeconds!)}</span> in this video. The game&apos;s sync,
          set before it was uploaded, says <span className="nums font-medium">{formatMSSd(seconds)}</span>.
        </>
      ) : (
        <>
          The game&apos;s sync was set before this video was uploaded. Check that the tip-off at{" "}
          <span className="nums font-medium">{formatMSSd(seconds)}</span> still lines up.
        </>
      )}
    </Callout>
  );
}

/**
 * The play-by-play runs well past the end of the video: the breaks between
 * quarters look cut out, so every later quarter lands too late. "Set
 * quarters" opens the quarter-by-quarter sync; "Not cut" is the coach's
 * answer and the banner doesn't come back.
 */
export function BreaksCutBanner({
  overrunSeconds,
  onSetQuarters,
  onNotCut,
}: {
  overrunSeconds: number;
  onSetQuarters: () => void;
  onNotCut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Callout
      tone="warning"
      icon={<Scissors />}
      className="mx-4 mb-3 sm:mx-6"
      action={
        <span className="flex flex-wrap justify-end gap-2">
          <Button size="sm" disabled={busy} onClick={onSetQuarters}>
            Set quarters
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onNotCut();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            Not cut
          </Button>
        </span>
      }
    >
      The play-by-play runs <span className="nums font-medium">{formatSpan(overrunSeconds)}</span> past the end of this video, so the breaks
      look cut out. Set where each quarter starts so its plays line up.
    </Callout>
  );
}
