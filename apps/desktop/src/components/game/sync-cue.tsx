import { useEffect, useState } from "react";
import type { PlayCue } from "@scoutable/shared/lib/sync-check";
import { cn } from "@/lib/utils";

/** How long the cue stays lit after the moment the sync has the play at. */
const LIT_SECONDS = 1.4;

/**
 * While a play is being checked: the app's own scoreboard, over the footage.
 * It changes to the play's score at the moment the sync has the play at, and
 * lights up as it does, so the question "is it in the right place?" is
 * answered by watching the ball and the cue together, without looking away
 * to a scrubber. For a play that doesn't score, the play's name lights up.
 */
export function SyncCue({ video, at, cue, label }: { video: HTMLVideoElement; at: number; cue: PlayCue; label: string }) {
  const [phase, setPhase] = useState<"before" | "now" | "after">("before");
  useEffect(() => {
    let raf = 0;
    const read = () => {
      const t = video.currentTime;
      const next = t < at ? "before" : t < at + LIT_SECONDS ? "now" : "after";
      setPhase((was) => (was === next ? was : next));
    };
    const tick = () => {
      read();
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!video.paused && !video.ended) {
        if (!raf) raf = requestAnimationFrame(tick);
        return;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      read();
    };
    sync();
    const events = ["play", "playing", "pause", "ended", "seeked", "timeupdate"] as const;
    for (const ev of events) video.addEventListener(ev, sync);
    return () => {
      for (const ev of events) video.removeEventListener(ev, sync);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [video, at]);

  const score = cue.score ? (phase === "before" ? cue.score.before : cue.score.after) : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center" aria-hidden>
      <div
        data-sync="cue"
        data-phase={phase}
        className={cn(
          "dark flex h-8 items-center gap-2 rounded-full px-3.5 text-sm font-semibold nums shadow-menu ring-1 backdrop-blur-xl",
          "transition-[background-color,color,transform,box-shadow] duration-150 ease-out motion-reduce:transition-none",
          phase === "now" ? "scale-110 bg-white text-black ring-white motion-reduce:scale-100" : "bg-black/60 text-white ring-white/15",
        )}
      >
        <span className={cn("font-medium", phase === "now" ? "text-black/70" : "text-white/70")}>{label}</span>
        {score && (
          <span>
            {score.home}–{score.away}
          </span>
        )}
      </div>
    </div>
  );
}
