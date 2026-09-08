/**
 * Small localStorage-backed preferences (web twin of desktop's lib/prefs.ts).
 *
 * Color-theme slots — one remembered theme id per light/dark mode, so mode
 * changes swap between the user's two picks. Keys are shared verbatim with
 * desktop, and the anti-flash boot script inlined in app/layout.tsx reads
 * the same literals: rename them everywhere or not at all. Validation
 * against the registry happens in ColorThemeProvider.
 */

const THEME_SLOT_KEYS = {
  dark: "scoutable_theme_dark",
  light: "scoutable_theme_light",
} as const;

export function getColorThemeSlot(mode: "dark" | "light"): string | null {
  try {
    return localStorage.getItem(THEME_SLOT_KEYS[mode]);
  } catch {
    return null;
  }
}

export function setColorThemeSlot(mode: "dark" | "light", themeId: string): void {
  try {
    localStorage.setItem(THEME_SLOT_KEYS[mode], themeId);
  } catch {
    // Storage unavailable (private mode etc.) — theme still applies for the session.
  }
}
