import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The text styles in tailwind.config.js `fontSize` (same names as the web's). */
export const TEXT_STYLE_NAMES = [
  "large-title",
  "title-1",
  "title-2",
  "title-3",
  "headline",
  "body",
  "callout",
  "subheadline",
  "footnote",
  "caption",
] as const;

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...TEXT_STYLE_NAMES] }] } },
});

/** Joins class names, later ones winning conflicts (`text-foreground` vs `text-muted-foreground`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
