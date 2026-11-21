import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Watch": opens the team's plays in Plays. The only control on the Season
 * view that opens plays, so it alone wears the accent; the counts beside it
 * stay in secondary text (docs/teams.md, "Plays").
 */
export function WatchLink({ onClick, children = "Watch", label, icon = false, className }: {
  onClick: () => void;
  children?: React.ReactNode;
  /** Names what it opens for a screen reader when the visible word is only "Watch". */
  label?: string;
  icon?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded text-subheadline text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection",
        className,
      )}
    >
      {icon && <Play className="size-3 fill-current" aria-hidden />}
      {children}
    </button>
  );
}
