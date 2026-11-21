import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The quiet control of toolbars and filter rows, after Notion's search
 * filters: no fill, ring or shadow at rest, so a row of them reads as words
 * rather than a row of boxes. The neutral fill arrives on hover and while its
 * menu is open, and stays while the filter is on. Its width is its label's.
 * Text fields and the choice menus of forms keep their borders; this is for
 * controls that sit on a bar.
 */
export const quietControl = cn(
  "inline-flex h-7 max-w-60 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap outline-none",
  "transition-[background-color,color,transform] duration-100 active:scale-[0.97] active:bg-fill-3",
  "hover:bg-fill-2 hover:text-foreground data-[state=open]:bg-fill-2 data-[state=open]:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-50 disabled:active:scale-100",
  "[&_svg]:shrink-0",
);

/** A quiet control's colours: muted at rest, filled and in the text colour while on. */
export function quietState(active: boolean) {
  return active ? "bg-fill-2 text-foreground hover:bg-fill-3" : "text-muted-foreground";
}

export function FilterButton({
  label,
  icon,
  active = false,
  chevron = "down",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** On: a value is chosen, so the control keeps its fill. */
  active?: boolean;
  chevron?: "down" | "none";
}) {
  return (
    <button type="button" className={cn(quietControl, quietState(active), "[&_svg]:size-3.5", className)} {...props}>
      {icon}
      <span className="truncate">{label}</span>
      {chevron === "down" && <ChevronDown className="size-3! opacity-70" aria-hidden />}
    </button>
  );
}
