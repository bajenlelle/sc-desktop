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
    background: "#09131a",
    foreground: "#d8dfe4",
    card: "#121c23",
    primary: "#00bcd8",
    primaryForeground: "#09131a",
    muted: "#202a32",
    mutedForeground: "#93999e",
    border: "#2a343c",
    destructive: "#ff6467",
  },
} as const;

/** Accepts RN's ColorSchemeName ("light" | "dark" | "unspecified" | null | undefined). */
export function themeColors(scheme: string | null | undefined) {
  return scheme === "dark" ? palette.dark : palette.light;
}
