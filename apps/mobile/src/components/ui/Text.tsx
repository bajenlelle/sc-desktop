import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cn } from "@/lib/cn";

/**
 * The web app's text styles at touch sizes (apps/web/src/app/globals.css,
 * `pointer: coarse`), defined as `fontSize` entries in tailwind.config.js so
 * a className can still override weight or colour. The system font: SF Pro on
 * iOS, Roboto on Android. No letter-spacing: iOS applies SF's size-specific
 * tracking itself, which the web approximates by hand. Text follows the
 * system text size.
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

/** The same styles as plain values, for native options that take a style object (header titles). */
export const TEXT_STYLES = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
} as const;
