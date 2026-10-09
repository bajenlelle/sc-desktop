import { cn } from "@/lib/utils";

/**
 * The house task-progress bar — the single home for the thin determinate bar
 * used by long-running operations (share uploads, playlist exports, the
 * update banner). Stat/watch bars (PlaylistCard, team comparisons) are a
 * different semantic and don't use this.
 *
 * The fill moves with a transform (compositor-only, never a layout pass),
 * easing out like a spring. `percent === null` means the total is unknown:
 * a short segment slides along the track instead of guessing — callers pair
 * it with a text readout that shows movement ("Preparing clips…").
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
  const clamped = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped ?? undefined}
      className={cn("h-1.5 overflow-hidden rounded-full bg-fill-2", className)}
    >
      <div
        className={cn(
          "h-full w-full origin-left rounded-full bg-primary transition-transform duration-300 ease-spring",
          clamped === null && "animate-progress-indeterminate",
          fillClassName
        )}
        style={clamped === null ? undefined : { transform: `scaleX(${clamped / 100})` }}
      />
    </div>
  );
}
