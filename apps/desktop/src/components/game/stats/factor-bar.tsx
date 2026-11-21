import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The value's share of a fixed scale, 0 to 1; past the end fills it. */
function share(value: number | null, scale: number): number {
  if (value === null || !(value > 0)) return 0;
  return Math.min(1, value / scale);
}

export function WithHover({ hover, children }: { hover?: ReactNode; children: ReactNode }) {
  if (!hover) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{hover}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A value on a fixed scale, growing away from the label (`grow` names the
 * direction), with an optional 2 px line across the track at `mark` on the
 * same scale: the team's season in the game's Stats view, the league's
 * average on a team's page. Decorative: the numbers beside it say the same.
 */
export function FactorBar({
  value,
  mark,
  scale,
  colour,
  grow,
  hover,
}: {
  value: number | null;
  mark: number | null;
  scale: number;
  colour: string;
  grow: "left" | "right";
  hover?: ReactNode;
}) {
  const at = share(mark, scale) * 100;
  return (
    <WithHover hover={hover}>
      <div className={cn("relative flex h-3.5 items-center", grow === "left" && "justify-end")} aria-hidden>
        <div className="h-2 rounded-full opacity-60" style={{ width: `${share(value, scale) * 100}%`, backgroundColor: colour }} />
        {mark !== null && (
          <span
            data-season-mark=""
            className="absolute inset-y-0 w-0.5 rounded-full bg-foreground"
            style={grow === "left" ? { right: `calc(${at}% - 1px)` } : { left: `calc(${at}% - 1px)` }}
          />
        )}
      </div>
    </WithHover>
  );
}
