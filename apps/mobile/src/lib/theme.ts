/**
 * Palette constants for surfaces NativeWind classes can't reach (navigator
 * backgrounds, ActivityIndicator colors, StatusBar). Values mirror
 * tailwind.config.js, which mirrors apps/web/src/app/globals.css.
 */
export const palette = {
  light: {
    background: "#fcfcfc",
    foreground: "#020405",
    card: "#fcfcfc",
    primary: "#0096b1",
    primaryForeground: "#ffffff",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
    destructive: "#e7000b",
  },
  dark: {
    background: "#030a11",
    foreground: "#d8dfe4",
    card: "#09131a",
    primary: "#00bcd8",
    primaryForeground: "#030a11",
    muted: "#172128",
    mutedForeground: "#8a9095",
    border: "#1e282f",
    destructive: "#ff6467",
  },
} as const;

/** Accepts RN's ColorSchemeName ("light" | "dark" | "unspecified" | null | undefined). */
export function themeColors(scheme: string | null | undefined) {
  return scheme === "dark" ? palette.dark : palette.light;
}
