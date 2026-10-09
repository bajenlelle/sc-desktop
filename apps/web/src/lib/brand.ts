/**
 * The brand's fixed colours, for surfaces that can't read the app's CSS
 * variables, such as generated images (the highlight share card). They
 * match the logo (components/logo.tsx): the night tile, the light letters
 * and the cyan dot.
 */
export const BRAND = {
  /** The card's night background. */
  ink: "#0c1018",
  /** The logo tile; the middle of the card's gradient. */
  inkRaised: "#161b24",
  /** Where the card's gradient ends. */
  plum: "#1a1430",
  /** Letters on the night background. */
  paper: "#f1f5f9",
  /** The dot after the wordmark. */
  cyan: "#22d3ee",
} as const;

/** A brand colour at an opacity, as rgba(), for gradients and washes. */
export function brandAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
