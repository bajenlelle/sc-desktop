import type { Label } from "@scoutable/shared/types/labels";
import { labelChipClasses } from "@/lib/label-colors";
import { cn } from "@/lib/utils";

interface LabelChipProps {
  label: Pick<Label, "name" | "color">;
  className?: string;
}

export function LabelChip({ label, className }: LabelChipProps) {
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
