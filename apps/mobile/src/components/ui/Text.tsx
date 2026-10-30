import { createContext, useContext } from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "@/lib/cn";
import { interStyle, weightFromClassName, type FontWeight } from "@/lib/fonts";

/**
 * The web app's text styles at touch sizes (apps/web/src/app/globals.css,
 * `pointer: coarse`), defined as `fontSize` entries in tailwind.config.js
 * (size, leading, tracking, weight) so a className can still override weight
 * or colour. Set in Inter (lib/fonts.ts), with Inter's own size-specific
 * tracking. Text follows the system text size; pass `maxFontSizeMultiplier`
 * where a bar can't grow. Don't follow a variant with a `text-[Npx]` size
 * class: the tracking is in em of the variant's own size.
 */
const VARIANT_CLASS = {
  largeTitle: "text-large-title",
  title1: "text-title-1",
  title2: "text-title-2",
  title3: "text-title-3",
  headline: "text-headline",
  body: "text-body",
  callout: "text-callout",
  subheadline: "text-subheadline",
  footnote: "text-footnote",
  caption: "text-caption",
} as const;

export type TextVariant = keyof typeof VARIANT_CLASS;

/**
 * The weight each variant sets in tailwind.config.js. The others set none, so
 * text nested in a heavier parent keeps the parent's weight, as in CSS.
 */
const VARIANT_WEIGHT: Partial<Record<TextVariant, FontWeight>> = {
  largeTitle: 600,
  title1: 400,
  title2: 600,
  title3: 600,
  headline: 600,
  caption: 500,
};

/** The weight of the enclosing Text, for nested runs. */
const WeightContext = createContext<FontWeight | null>(null);

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Tabular figures, for counts, clocks and dates that line up and don't jitter. */
  nums?: boolean;
  className?: string;
}

export function Text({ variant = "body", nums, className, style, children, ...props }: TextProps) {
  const parentWeight = useContext(WeightContext);
  const classes = cn("text-foreground", VARIANT_CLASS[variant], className);
  // Each Inter weight is its own font file, so the weight picks the family.
  const weight = weightFromClassName(classes) ?? VARIANT_WEIGHT[variant] ?? parentWeight ?? 400;
  const italic = /(^|\s)italic(\s|$)/.test(classes);
  return (
    <RNText className={classes} style={[interStyle(weight, italic), nums ? { fontVariant: ["tabular-nums"] } : null, style]} {...props}>
      <WeightContext.Provider value={weight}>{children}</WeightContext.Provider>
    </RNText>
  );
}
