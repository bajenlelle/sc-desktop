import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Trash2, X } from "lucide-react";
import { riseVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Labels show when the list column is wide enough (a container query on
 * the list, see SelectionBar); icons carry the meaning below that.
 */
export const PILL_LABEL = "hidden @min-[30rem]:inline";

/** A compact action in the selection pill. */
export const PillButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { tone?: "default" | "destructive"; icon?: boolean }
>(function PillButton({ className, tone = "default", icon = false, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,transform,opacity] duration-100 active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-selection [&_svg]:size-3.5 [&_svg]:shrink-0",
        icon && "w-7 justify-center px-0",
        tone === "destructive"
          ? "text-destructive hover:bg-destructive/10 active:bg-destructive/20"
          : "text-foreground hover:bg-fill-2 active:bg-fill-4 data-[state=open]:bg-fill-3",
        className,
      )}
      {...props}
    />
  );
});

export interface SelectionGroupAction {
  kind: "group" | "ungroup";
  disabled: boolean;
  reason?: string;
  onClick: () => void;
}

/**
 * What you can do with the rows you picked, floating over the bottom of the
 * list the moment something is selected and leaving the same way. It never
 * pushes the rows around. The parent must be a `@container`.
 */
export function SelectionBar({
  count,
  onRemove,
  onClear,
  group,
  labelPicker,
  addTo,
}: {
  count: number;
  onRemove: () => void;
  onClear: () => void;
  group: SelectionGroupAction | null;
  labelPicker?: React.ReactNode;
  addTo: React.ReactNode;
}) {
  const groupLabel = group?.kind === "ungroup" ? "Ungroup" : "Group";
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="selection-bar"
          variants={riseVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3"
        >
          <div
            role="toolbar"
            aria-label="Selection"
            className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-full bg-material-popover py-1 pr-1 pl-3 shadow-menu ring-1 ring-separator backdrop-blur-xl"
          >
            <span className="mr-1 shrink-0 text-sm font-medium nums">
              {count}
              <span className={cn(PILL_LABEL, "ml-1")}>selected</span>
            </span>
            <PillButton tone="destructive" onClick={onRemove} title="Remove from playlist">
              <Trash2 />
              <span className={PILL_LABEL}>Remove</span>
            </PillButton>
            {group && (
              <PillButton disabled={group.disabled} title={group.reason ?? groupLabel} onClick={group.onClick}>
                <Link2 />
                <span className={PILL_LABEL}>{groupLabel}</span>
              </PillButton>
            )}
            {labelPicker}
            {addTo}
            <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-separator" />
            <PillButton icon aria-label="Clear selection" title="Clear selection" onClick={onClear}>
              <X />
            </PillButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
