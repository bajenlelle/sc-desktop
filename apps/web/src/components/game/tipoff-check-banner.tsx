"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { formatMSSd } from "@scoutable/shared/lib/clip-timing";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { trackEvent } from "@/lib/analytics";

/**
 * Our converter applied a tip-off it was confident about, and the plays are
 * lined up with it; the uploader is asked to check before trusting the
 * clips. "Looks right" confirms it (and leaves a confirmed hint for the next
 * import of this recording); "Check" opens the picker at that frame.
 */
export function TipoffCheckBanner({
  video,
  seconds,
  onLooksRight,
  onCheck,
}: {
  video: GameVideo;
  /** The applied tip-off, from the match's sync point. */
  seconds: number;
  onLooksRight: () => Promise<void>;
  onCheck: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    trackEvent("tipoff_check_shown", { sync_status: video.syncStatus, confidence: video.suggestedConfidence });
    // Once per banner, not per re-render of the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  return (
    <Callout
      tone="warning"
      icon={<Sparkles />}
      className="mx-4 mb-3 sm:mx-6"
      action={
        <span className="flex gap-2">
          <Button
            size="sm"
            disabled={confirming}
            onClick={async () => {
              setConfirming(true);
              try {
                await onLooksRight();
              } finally {
                setConfirming(false);
              }
            }}
          >
            {confirming && <Loader2 className="animate-spin" />}
            Looks right
          </Button>
          <Button size="sm" variant="outline" disabled={confirming} onClick={onCheck}>
            Check
          </Button>
        </span>
      }
    >
      We found the tip-off at <span className="nums font-medium">{formatMSSd(seconds)}</span>. Check it before you trust the clips.
    </Callout>
  );
}
