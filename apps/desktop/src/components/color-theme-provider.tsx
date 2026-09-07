/**
 * Applies the user's chosen color theme on top of next-themes' light/dark
 * mode: the active theme is the stored slot for the resolved mode, projected
 * onto <html data-theme="…"> (see themes.css). next-themes stays the single
 * source of truth for the mode itself — picking a theme of the other mode
 * flips the mode rather than fighting it.
 *
 * Before hydration (resolvedTheme undefined) the inline boot script in
 * index.html owns the attribute, so this deliberately does nothing then —
 * touching it early would flash the default theme over the stored one.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_THEME, getTheme, type ThemeMode } from "@/lib/themes";
import { getColorThemeSlot, setColorThemeSlot } from "@/lib/prefs";
import { trackEvent } from "@/lib/analytics";

interface ColorThemeContextValue {
  /** Theme id currently applied (the slot for the resolved mode). */
  activeThemeId: string;
  setColorTheme: (id: string) => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

/** Stored slot for a mode, falling back past unknown/mismatched ids. */
function slotFor(mode: ThemeMode): string {
  const stored = getColorThemeSlot(mode);
  return getTheme(stored)?.mode === mode ? (stored as string) : DEFAULT_THEME[mode];
}

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [slots, setSlots] = useState<Record<ThemeMode, string>>(() => ({
    dark: slotFor("dark"),
    light: slotFor("light"),
  }));

  const mode: ThemeMode | undefined =
    resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : undefined;
  const activeThemeId = slots[mode ?? "dark"];

  useEffect(() => {
    if (!mode) return;
    document.documentElement.dataset.theme = slots[mode];
    // Keep the native titlebar on the same side as the content — without
    // this, a light theme on a dark-mode Mac gets a dark titlebar.
    getCurrentWindow()
      .setTheme(mode)
      .catch(() => {});
  }, [mode, slots]);

  const setColorTheme = useCallback(
    (id: string) => {
      const theme = getTheme(id);
      if (!theme) return;
      setColorThemeSlot(theme.mode, id);
      setSlots((prev) => ({ ...prev, [theme.mode]: id }));
      if (mode !== theme.mode) setTheme(theme.mode);
      trackEvent("color_theme_changed", { theme: id, mode: theme.mode });
    },
    [mode, setTheme],
  );

  return (
    <ColorThemeContext.Provider value={{ activeThemeId, setColorTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme(): ColorThemeContextValue {
  const ctx = useContext(ColorThemeContext);
  if (!ctx) throw new Error("useColorTheme must be used within ColorThemeProvider");
  return ctx;
}
