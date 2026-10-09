"use client";

import { MotionConfig } from "framer-motion";
import { springs } from "@/lib/motion";

/**
 * Motion for the signed-in app: every framer-motion animation uses the
 * standard spring unless it says otherwise, and under the system's reduced
 * motion setting transforms and layout animations turn off while opacity
 * still fades. The signed-out pages don't load framer-motion at all.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={springs.standard}>
      {children}
    </MotionConfig>
  );
}
