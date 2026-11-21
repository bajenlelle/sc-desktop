import type { Label } from "@scoutable/shared/types/labels";
import { labelChipClasses, labelDotClasses } from "@/lib/label-colors";
import { cn } from "@/lib/utils";

interface LabelChipProps {
  label: Pick<Label, "name" | "color">;
  /**
   * "quiet" is the play rows' form: a neutral pill with the label's colour as a
   * dot, so it reads apart from the event's dot. In a narrow row it is the dot
   * alone, with the name in its tooltip.
   */
  variant?: "default" | "quiet";
  className?: string;
}

export function LabelChip({ label, variant = "default", className }: LabelChipProps) {
  if (variant === "quiet") {
    return (
      <span
        title={label.name}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full bg-fill-2 py-px pr-1.5 pl-1.5 text-[11px] leading-tight whitespace-nowrap text-muted-foreground",
          "@max-[480px]/row:bg-transparent @max-[480px]/row:px-0.5",
          className,
        )}
      >
        <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", labelDotClasses[label.color])} />
        <span className="@max-[480px]/row:sr-only">{label.name}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-tight",
        labelChipClasses[label.color],
        className,
      )}
    >
      {label.name}
    </span>
  );
}
