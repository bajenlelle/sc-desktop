/**
 * The only tinted surfaces the app draws. One place, so a screen can't invent
 * a sixth strength of primary: everything else is a neutral fill
 * (`bg-fill-1..4`), a hairline, or the card.
 */

/** A selected or active surface: the playing clip's pill, a filter that's on. */
export const TINT_SELECTED = "bg-primary/[0.12]";
/** The unfinished part of a progress segment. */
export const TINT_PROGRESS = "bg-primary/[0.35]";

/** Notices and callouts by tone (the web's values). */
export const TINT_CALLOUT = {
  warning: "bg-warning/[0.12]",
  success: "bg-success/[0.12]",
  destructive: "bg-destructive/[0.10]",
} as const;

/** Badges by tone (the web's values); the neutral badge is `bg-fill-2`. */
export const TINT_BADGE = {
  success: "bg-success/[0.14]",
  warning: "bg-warning/[0.14]",
  destructive: "bg-destructive/[0.12]",
} as const;
