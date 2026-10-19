"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fadeVariants } from "@/lib/motion";
import type { ExportActivity } from "./use-export";

/**
 * A running export in the toolbar, beside the ship pill: a spinner, where
 * it is ("Exporting · clip 3 of 8", "Joining…", "Uploading…", the words from
 * md up), a short bar, and a button that cancels it. Editing goes on
 * meanwhile; the file downloads, or the link opens, once it is ready.
 */
export function ExportPill({ activity, onCancel }: { activity: ExportActivity | null; onCancel: () => void }) {
  const outcome = activity?.purpose === "share" ? "the link opens when it's ready" : "the video downloads when it's ready";
  // "Joining…" ends a sentence already; "Exporting · clip 3 of 8" needs its stop.
  const label = activity ? (/[.…]$/.test(activity.label) ? activity.label : `${activity.label}.`) : "";
  // Read out on a change of step, not on every clip.
  const spoken = activity?.cancelling ? "Cancelling the export" : activity?.purpose === "share" ? "Making your link" : "Exporting the video";
  return (
    <AnimatePresence initial={false}>
      {activity && (
        <motion.div key="export" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex items-center">
          <div className="flex h-7 items-center gap-2 rounded-full bg-fill-1 pr-1 pl-2.5 text-xs text-muted-foreground nums pointer-coarse:h-9">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  <span role="status" className="sr-only">
                    {spoken}
                  </span>
                  <span aria-hidden className="hidden whitespace-nowrap md:inline">
                    {activity.label}
                  </span>
                  <ProgressBar percent={activity.percent} className="h-1 w-12 md:w-16" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {label} You can keep editing; {outcome}.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Cancel export"
                  disabled={!activity.canCancel}
                  onClick={onCancel}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,color,transform,opacity] duration-100 hover:bg-fill-3 hover:text-foreground active:scale-90 active:bg-fill-4 disabled:opacity-40 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-7"
                >
                  <X className="size-3 stroke-[2.5]" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Cancel export</TooltipContent>
            </Tooltip>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
