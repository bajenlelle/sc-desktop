/**
 * Appearance plumbing shared by the desktop shell: what the native window
 * should be told about the user's appearance setting.
 *
 * Under "system" the window must follow the OS on its own (null), so the
 * vibrancy material and title bar keep tracking later OS changes; an
 * explicit Light or Dark pins the window to the resolved mode so a light
 * theme on a dark Mac never gets a dark window.
 */
export type AppearanceSetting = "system" | "light" | "dark";
export type ResolvedMode = "light" | "dark";

export function isAppearanceSetting(value: unknown): value is AppearanceSetting {
  return value === "system" || value === "light" || value === "dark";
}

/** The argument for Tauri's `window.setTheme`: null means "follow the OS". */
export function windowThemeFor(
  setting: string | undefined,
  resolved: ResolvedMode | undefined,
): ResolvedMode | null {
  if (setting === undefined || setting === "system") return null;
  return resolved ?? null;
}

/** The id the native View › Appearance menu should check. */
export function menuAppearanceFor(setting: string | undefined): AppearanceSetting {
  return isAppearanceSetting(setting) ? setting : "system";
}
