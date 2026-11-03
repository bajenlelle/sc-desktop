/**
 * The strip that shows a coach which quarters a Fix sync choice moves: one
 * segment per period, the moved part tinted, a mark where the play is, and
 * the words under it. In the sheet it is the live answer to "which clips are
 * off?"; in the explainer it is the same picture in a fixed example state.
 */
import type * as React from "react";
import type { SyncReach } from "@scoutable/shared/lib/sync-reach";
import { cn } from "@/lib/utils";

export function SyncReachStrip({
  reach,
  tick = "play",
  caption,
  className,
}: {
  reach: SyncReach;
  /** "play": a thin line where the play is. "clip": a short pill, the one clip that moves. */
  tick?: "play" | "clip";
  caption?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {reach.segments.length > 0 && (
        <div className="flex gap-1" aria-hidden>
          {reach.segments.map((s) => (
            <div key={s.period} className="min-w-0 flex-1">
              <div
                className={cn(
                  "relative h-2 overflow-hidden rounded-full bg-fill-2",
                  // A period with its own sync starts fresh: a mark at its left edge.
                  s.set && "border-l-2 border-muted-foreground/60",
                )}
              >
                {s.moved && (
                  <span
                    className="absolute inset-y-0 rounded-full bg-primary"
                    style={{ left: `${s.moved.from * 100}%`, width: `${(s.moved.to - s.moved.from) * 100}%` }}
                  />
                )}
                {reach.play?.period === s.period &&
                  (tick === "clip" ? (
                    <span
                      className="absolute inset-y-0 w-1.5 rounded-full bg-primary"
                      style={{ left: `calc(${reach.play.at * 100}% - 3px)` }}
                    />
                  ) : (
                    <span
                      className="absolute inset-y-0 w-0.5 bg-foreground ring-1 ring-background"
                      style={{ left: `calc(${reach.play.at * 100}% - 1px)` }}
                    />
                  ))}
              </div>
              <div className="mt-1 truncate text-center text-footnote text-muted-foreground">{s.name}</div>
            </div>
          ))}
        </div>
      )}
      {caption && (
        <p className="text-callout text-muted-foreground" aria-live="polite">
          {caption}
        </p>
      )}
    </div>
  );
}
