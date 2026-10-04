/**
 * STATIC default-palette fallback — only for surfaces that render outside
 * MobileThemeProvider (the root ErrorBoundary). Everything else uses
 * useThemeColors() from lib/theme-context, which follows the active color
 * theme. Values equal THEME_TOKENS' default themes in
 * @scoutable/shared/lib/themes (change together).
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
