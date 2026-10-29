import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "@/lib/cn";

/**
 * The web app's text styles at touch sizes (apps/web/src/app/globals.css,
 * `pointer: coarse`), defined as `fontSize` entries in tailwind.config.js
 * (size, leading, tracking, weight) so a className can still override weight
 * or colour. The system font: SF Pro on iOS, Roboto on Android. Text follows
 * the system text size; pass `maxFontSizeMultiplier` where a bar can't grow.
 * Don't follow a variant with a `text-[Npx]` size class: the tracking is in
 * em of the variant's own size.
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

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Tabular figures, for counts, clocks and dates that line up and don't jitter. */
  nums?: boolean;
  className?: string;
}

export function Text({ variant = "body", nums, className, style, ...props }: TextProps) {
  return (
    <RNText
      className={cn("text-foreground", VARIANT_CLASS[variant], className)}
      style={nums ? [{ fontVariant: ["tabular-nums"] }, style] : style}
      {...props}
    />
  );
}

