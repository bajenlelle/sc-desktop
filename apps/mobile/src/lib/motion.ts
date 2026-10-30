/**
 * The web app's named springs (apps/web/src/lib/motion.ts), resolved to
 * Reanimated's stiffness/damping with mass 1 so motion feels the same on both.
 * Critically damped by default; `settle` keeps a little bounce for the end of
 * a gesture that carried momentum. Every spring honours the system's Reduce
 * Motion setting (it then jumps to the end).
 */
import { ReduceMotion, type WithSpringConfig } from "react-native-reanimated";

function spring(stiffness: number, damping: number): WithSpringConfig {
  return { stiffness, damping, mass: 1, reduceMotion: ReduceMotion.System };
}

export const springs = {
  /** Segmented and switch thumbs, the scrubber thumb. */
  snappy: spring(947.3, 61.56),
  /** The default: highlights that move between rows, expand/collapse, progress. */
  standard: spring(696.0, 52.76),
  /** Sheets and dialogs arriving. */
  gentle: spring(421.0, 41.04),
  /** After a fling or a rubber-banded drag only. */
  settle: spring(471.9, 36.93),
  /** Sheets and dialogs leaving. */
  exit: spring(2131.4, 92.33),
} as const;

/** Press feedback, applied on press-in as on the web (`active:scale-*`). Rows only fill. */
export const pressScale = {
  button: 0.97,
  control: 0.98,
  tab: 0.95,
  playerControl: 0.9,
  row: 1,
} as const;

/** Fades, in milliseconds (the web's scrim and fade variants). */
export const timing = {
  scrimIn: 180,
  scrimOut: 150,
  fadeIn: 150,
  fadeOut: 120,
} as const;
