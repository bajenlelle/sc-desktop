/**
 * Tailwind class maps for label palette tokens.
 *
 * Tailwind's content scanner cannot see dynamic strings like `bg-${color}-100`,
 * so each variant must appear verbatim in source. The maps below satisfy that.
 */
import type { LabelColor } from "@scoutable/shared/types/labels";

export { LABEL_COLORS } from "@scoutable/shared/types/labels";
export type { LabelColor };

/** Pill-style chip used wherever a label is rendered. */
export const labelChipClasses: Record<LabelColor, string> = {
  slate:    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  red:      "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  orange:   "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300",
  amber:    "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  emerald:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  teal:     "bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-300",
  cyan:     "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/60 dark:text-cyan-300",
  sky:      "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
  blue:     "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
  indigo:   "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300",
  violet:   "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300",
  fuchsia:  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/60 dark:text-fuchsia-300",
};

/** Solid 8px dot used inside the picker to preview the label colour. */
export const labelDotClasses: Record<LabelColor, string> = {
  slate:    "bg-slate-400",
  red:      "bg-red-400",
  orange:   "bg-orange-400",
  amber:    "bg-amber-400",
  emerald:  "bg-emerald-400",
  teal:     "bg-teal-400",
  cyan:     "bg-cyan-400",
  sky:      "bg-sky-400",
  blue:     "bg-blue-400",
  indigo:   "bg-indigo-400",
  violet:   "bg-violet-400",
  fuchsia:  "bg-fuchsia-400",
};

/** Larger swatch used in the colour-picker dropdown. */
export const labelSwatchClasses: Record<LabelColor, string> = {
  slate:    "bg-slate-500",
  red:      "bg-red-500",
  orange:   "bg-orange-500",
  amber:    "bg-amber-500",
  emerald:  "bg-emerald-500",
  teal:     "bg-teal-500",
  cyan:     "bg-cyan-500",
  sky:      "bg-sky-500",
  blue:     "bg-blue-500",
  indigo:   "bg-indigo-500",
  violet:   "bg-violet-500",
  fuchsia:  "bg-fuchsia-500",
};
