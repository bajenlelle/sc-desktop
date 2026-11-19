import { Check } from "lucide-react";
import { labelKeySlots } from "@scoutable/shared/lib/label-keys";
import type { Label } from "@scoutable/shared/types/labels";
import { Kbd } from "@/components/ui/kbd";
import { labelDotClasses } from "@/lib/label-colors";
import { cn } from "@/lib/utils";

/**
 * Which label each key puts on, shown over the corner of the stage while
 * Option is held (lib/label-keys.ts): nine keys are more than a coach keeps
 * in the head, and the answer has to come without leaving the game. Only the
 * digits are written, since Option is already down. A check marks the labels
 * the play on screen has, so the next press is known to take one off.
 * Something to read, not to press: the pointer goes through it.
 */
export function GameLabelKeys({ labels, on }: { labels: readonly Label[]; on: ReadonlySet<string> | undefined }) {
  const keys = labelKeySlots(labels).filter((k) => k.label !== null);
  return (
    <div
      data-state="open"
      aria-hidden
      className="pointer-events-none absolute right-2 bottom-2 z-20 w-56 rounded-lg bg-material-popover p-1.5 text-popover-foreground shadow-menu backdrop-blur-xl chrome-animate"
      style={{ transformOrigin: "bottom right" }}
    >
      <p className="px-1.5 pt-0.5 pb-1 text-caption text-muted-foreground">Label keys</p>
      {keys.length === 0 ? (
        <p className="px-1.5 pb-1 text-subheadline">None yet. Give a label a key from its row in the label picker.</p>
      ) : (
        keys.map(({ slot, label }) => (
          <div key={slot} className="flex items-center gap-2 px-1.5 py-0.5 text-subheadline">
            <Kbd className="h-4 min-w-4 text-caption">{slot}</Kbd>
            <span className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses[label!.color])} />
            <span className="min-w-0 flex-1 truncate">{label!.name}</span>
            {on?.has(label!.id) && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
          </div>
        ))
      )}
    </div>
  );
}
