"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fadeVariants } from "@/lib/motion";
import type { UseShip } from "./use-ship";

/**
 * Where the server is with the shared clips, in the toolbar: a spinner and
 * "Preparing clips · 3 of 8" with a short bar while a job runs, and what
 * couldn't be cut with a way to try again. Nothing when there is nothing
 * to say (a finished job speaks through its toast).
 */
export function ShipPill({ ship }: { ship: UseShip }) {
  const running = ship.phase === "requesting" || ship.phase === "running";
  const failed = ship.phase === "failed";
  const label = running
    ? ship.total > 0
      ? `Preparing clips · ${ship.done} of ${ship.total}`
      : "Preparing clips…"
    : ship.failed > 0
      ? `Couldn't prepare ${ship.failed} ${ship.failed === 1 ? "clip" : "clips"}`
      : "Couldn't prepare the clips";
  return (
    <AnimatePresence initial={false}>
      {(running || failed) && (
        <motion.div key={running ? "running" : "failed"} variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex items-center">
          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="status"
                  aria-live="polite"
                  className="flex h-7 items-center gap-2 rounded-full bg-fill-1 px-2.5 text-xs text-muted-foreground nums pointer-coarse:h-9"
                >
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  <span className="hidden whitespace-nowrap md:inline">{label}</span>
                  <ProgressBar percent={ship.total > 0 ? (ship.done / ship.total) * 100 : null} className="h-1 w-12 md:w-16" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}. Recipients see each clip as it is ready.</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={ship.retry}
              className="flex h-7 items-center gap-1.5 rounded-full bg-warning/12 px-2.5 text-xs font-medium whitespace-nowrap text-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-warning/20 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:h-9"
            >
              <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="hidden md:inline">{label} ·</span>
              <span>Try again</span>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
