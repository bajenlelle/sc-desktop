/**
 * The app's motion vocabulary, in Apple's terms rather than durations.
 *
 * Every spring here is critically damped (bounce 0): graceful, never
 * distracting. `settle` is the one exception and is reserved for the
 * moment after the user's own momentum (a drag release), where a little
 * overshoot reads as physical. framer-motion's perceptual `duration` is the
 * spring's "response"; a spring has no fixed length, it settles.
 *
 * `MotionConfig reducedMotion="user"` in components/providers.tsx turns transform and layout
 * animations off under prefers-reduced-motion while opacity still fades, so
 * variants need no reduced-motion branches of their own.
 */
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

export const springs = {
  /** Buttons, selection thumbs, small state changes. */
  snappy: { type: "spring", duration: 0.3, bounce: 0 },
  /** Menus, popovers, the sidebar, most UI. */
  standard: { type: "spring", duration: 0.35, bounce: 0 },
  /** Dialogs and sheets. */
  gentle: { type: "spring", duration: 0.45, bounce: 0 },
  /** After momentum only: a flick or a drag release. */
  settle: { type: "spring", duration: 0.4, bounce: 0.15 },
  /** Leaving is quicker than arriving. */
  exit: { type: "spring", duration: 0.2, bounce: 0 },
} as const satisfies Record<string, Transition>;

/** A dimming scrim behind a modal task. */
export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.18, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeIn" } },
};

/** A dialog materialises: blur, scale and a few pixels of rise together. */
export const dialogVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8, filter: "blur(4px)" },
  visible: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transition: springs.gentle },
  exit: { opacity: 0, scale: 0.98, y: 4, filter: "blur(2px)", transition: springs.exit },
};

/** A macOS sheet: anchored to the top, slides down and leaves the same way. */
export const sheetVariants: Variants = {
  hidden: { opacity: 0, y: -24 },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
  exit: { opacity: 0, y: -16, transition: springs.exit },
};

/** Floating bars that rise from the bottom edge (selection bar). */
export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: springs.standard },
  exit: { opacity: 0, y: 24, transition: springs.exit },
};

/** Plain cross-fade for content swaps. */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: "easeIn" } },
};

/** `useReducedMotion` returns null before hydration; treat that as "no". */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}
