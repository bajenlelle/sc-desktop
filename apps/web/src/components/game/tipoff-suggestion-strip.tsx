"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { formatMSSd } from "@scoutable/shared/lib/clip-timing";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * What our converter found out about this recording's tip-off, in one strip
 * above the picker, read off the row's sync status: still looking, a time
 * it isn't sure of, or nothing. (A confident find is applied to the game and
 * shown as the check banner on the watch view instead.) The states
 * cross-fade in place so the footage below moves smoothly.
 */
export function TipoffSuggestionStrip({
  video,
  dismissed = false,
  onUse,
  onSetManually,
}: {
  video: GameVideo;
  /** The user chose to set it themselves: the offer is withdrawn. */
  dismissed?: boolean;
  onUse: (seconds: number) => void;
  onSetManually: () => void;
}) {
  const content = render();
  return (
    <AutoHeight>
      <AnimatePresence mode="popLayout" initial={false}>
        {content && (
          <motion.div key={content.key} variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="pb-3">
            {content.node}
          </motion.div>
        )}
      </AnimatePresence>
    </AutoHeight>
  );

  function shell(children: React.ReactNode, tone: "quiet" | "offer" = "quiet") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-sm",
          tone === "offer" ? "bg-primary/8 ring-1 ring-primary/25" : "bg-fill-1",
        )}
      >
        {children}
      </div>
    );
  }

  function render(): { key: string; node: React.ReactNode } | null {
    if (dismissed) return null;
    switch (video.syncStatus) {
      case "pending":
        return {
          key: "pending",
          node: shell(
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p>Looking for the tip-off…</p>
                <p className="text-callout text-muted-foreground">You don&apos;t have to wait: scrub to it below and set it yourself.</p>
              </div>
            </>,
          ),
        };
      case "suggested": {
        const seconds = video.suggestedTipoffSeconds;
        if (seconds === null) return null;
        return {
          key: "suggested",
          node: shell(
            <>
              <Sparkles className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                Tip-off found at <span className="nums">{formatMSSd(seconds)}</span> (not certain). Check the frame before you use it.
              </span>
              <span className="flex shrink-0 gap-2">
                <Button type="button" size="sm" onClick={() => onUse(seconds)}>
                  Use <span className="nums">{formatMSSd(seconds)}</span>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onSetManually}>
                  Set manually
                </Button>
              </span>
            </>,
            "offer",
          ),
        };
      }
      case "not_found":
        return {
          key: "none",
          node: shell(<span className="text-muted-foreground">No tip-off found automatically. Scrub to it below.</span>),
        };
      default:
        return null;
    }
  }
}
