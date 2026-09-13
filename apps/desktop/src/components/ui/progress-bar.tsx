import { cn } from "@/lib/utils";

/**
 * The house task-progress bar — the single home for the thin determinate bar
 * used by long-running operations (share uploads, playlist exports, the
 * update banner). Stat/watch bars (PlaylistCard, team comparisons) are a
 * different semantic and don't use this.
 *
 * `percent === null` means the total is unknown: hold a small sliver instead
 * of guessing — callers pair the bar with a text readout that shows movement
 * (a byte counter, "Preparing clips…").
 */
export function ProgressBar({
  percent,
  className,
  fillClassName,
}: {
  /** 0–100, or null for indeterminate. Clamped. */
  percent: number | null;
  /** Merged onto the track (e.g. width, margins, or a track color override). */
  className?: string;
  /** Merged onto the fill (e.g. a color override for non-default backgrounds). */
  fillClassName?: string;
}) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full bg-primary transition-all", fillClassName)}
        style={{ width: percent !== null ? `${Math.max(0, Math.min(100, percent))}%` : "5%" }}
      />
    </div>
  );
}
