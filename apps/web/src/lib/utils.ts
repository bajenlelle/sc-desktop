import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The text styles defined in globals.css (`text-title-3`, `text-subheadline`,
 * …) look like colour classes to tailwind-merge, which would drop them
 * whenever a `text-{colour}` follows in the same cn() call. Teach it that
 * they are sizes, so they conflict with `text-sm`, not with `text-foreground`.
 */
const TEXT_STYLES = [
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
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": TEXT_STYLES.map((s) => `text-${s}`),
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
