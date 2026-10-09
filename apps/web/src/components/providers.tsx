"use client";

import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { springs } from "@/lib/motion";

/**
 * Motion for the signed-in app: every framer-motion animation uses the
 * standard spring unless it says otherwise, and under the system's reduced
 * motion setting transforms and layout animations turn off while opacity
 * still fades. Tooltips share one provider, so the first along a toolbar
 * waits and the next open at once. The signed-out pages load neither.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={springs.standard}>
      <TooltipProvider>{children}</TooltipProvider>
    </MotionConfig>
  );
}
