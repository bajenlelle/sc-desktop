"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { fadeVariants } from "@/lib/motion";

export interface StatsSuggestionProps {
  severalGames: boolean;
  /** One game's numbers ("24 PTS · 8 REB · 5 AST vs AIK"), once read; null with several games. */
  line: string | null;
  add: () => void;
  dismiss: () => void;
}

/**
 * The editor's one-time nudge in a personal space, the desktop's: "Show
 * your stats in the video", with the game's numbers when the clips come
 * from one game (season averages when they span several). Not now puts it
 * away for this playlist; Add stats card opens the inspector for a card at
 * the start. It fades in and out while the list below springs to its new
 * place.
 */
export function StatsCardSuggestion({ suggestion, className }: { suggestion: StatsSuggestionProps | null; className?: string }) {
  return (
    <AutoHeight>
      <AnimatePresence initial={false} mode="popLayout">
        {suggestion && (
          <motion.div key="stats-suggestion" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className={className}>
            <Callout icon={<BarChart3 />}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1 basis-48">
                  {suggestion.severalGames ? "Show your season averages in the video" : "Show your stats in the video"}
                  {suggestion.line && <span className="text-muted-foreground nums">{` · ${suggestion.line}`}</span>}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button size="xs" variant="ghost" onClick={suggestion.dismiss}>
                    Not now
                  </Button>
                  <Button size="xs" variant="outline" onClick={suggestion.add}>
                    Add stats card
                  </Button>
                </span>
              </div>
            </Callout>
          </motion.div>
        )}
      </AnimatePresence>
    </AutoHeight>
  );
}
