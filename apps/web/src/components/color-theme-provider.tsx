"use client";

/**
 * Web twin of desktop's color-theme provider (apps/desktop/src/components/
 * color-theme-provider.tsx — keep in sync; the only intended delta is the
 * missing Tauri titlebar call). Applies the user's chosen color theme on top
 * of next-themes' light/dark mode: the active theme is the stored slot for
 * the resolved mode, projected onto <html data-theme="…"> (see themes.css).
 *
 * Two ways slots change:
 * - setColorTheme: a user pick — flips mode if needed, fires analytics. The
 *   ThemeSync watcher sees the slot change and persists it to the profile.
 * - adoptColorThemes: another device's synced pick arriving — apply + local
 *   persist ONLY (no mode flip, no analytics, no server write).
 *
 * Before hydration (resolvedTheme undefined) the inline boot script in
 * app/layout.tsx owns the attribute, so this deliberately does nothing then.
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
import { DEFAULT_THEME, getTheme, type ThemeMode } from "@scoutable/shared/lib/themes";
import { getColorThemeSlot, setColorThemeSlot } from "@/lib/prefs";
import { trackEvent } from "@/lib/analytics";

interface ColorThemeContextValue {
  /** Theme id currently applied (the slot for the resolved mode). */
  activeThemeId: string;
  /** The remembered theme per mode — what ThemeSync watches and syncs. */
  slots: Record<ThemeMode, string>;
  setColorTheme: (id: string) => void;
  /** Sync adoption: apply + persist locally, nothing else. */
  adoptColorThemes: (prefs: { themeDark?: string; themeLight?: string }) => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

/** Stored slot for a mode, falling back past unknown/mismatched ids. */
function slotFor(mode: ThemeMode): string {
  const stored = getColorThemeSlot(mode);
  return getTheme(stored)?.mode === mode ? (stored as string) : DEFAULT_THEME[mode];
}

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();
  // Lazy init reads localStorage — fine on the client; during SSR this
  // component renders children only, and the boot script owns first paint.
  const [slots, setSlots] = useState<Record<ThemeMode, string>>(() => ({
    dark: typeof window === "undefined" ? DEFAULT_THEME.dark : slotFor("dark"),
    light: typeof window === "undefined" ? DEFAULT_THEME.light : slotFor("light"),
  }));

  const mode: ThemeMode | undefined =
    resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : undefined;
  const activeThemeId = slots[mode ?? "dark"];

  useEffect(() => {
    if (!mode) return;
    document.documentElement.dataset.theme = slots[mode];
    // Forced-dark islands (`dark` class wrappers) re-declare every token from
    // the base .dark block; projecting the dark slot separately lets
    // themes.css restyle them with the user's dark theme in both modes.
    // (No such wrapper exists on web today — kept for parity with desktop
    // and for any future dark video chrome.)
    document.documentElement.dataset.themeDark = slots.dark;
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

  const adoptColorThemes = useCallback(
    (prefs: { themeDark?: string; themeLight?: string }) => {
      setSlots((prev) => {
        let next = prev;
        for (const [slotMode, id] of [
          ["dark", prefs.themeDark],
          ["light", prefs.themeLight],
        ] as const) {
          // Unknown or mode-mismatched ids (e.g. from a newer client) are
          // skipped: the default palette keeps showing, and the watcher's
          // raw ref ensures we never clobber the value back.
          if (!id || getTheme(id)?.mode !== slotMode || prev[slotMode] === id) continue;
          setColorThemeSlot(slotMode, id);
          if (next === prev) next = { ...prev };
          next[slotMode] = id;
        }
        return next;
      });
    },
    [],
  );

  return (
    <ColorThemeContext.Provider value={{ activeThemeId, slots, setColorTheme, adoptColorThemes }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme(): ColorThemeContextValue {
  const ctx = useContext(ColorThemeContext);
  if (!ctx) throw new Error("useColorTheme must be used within ColorThemeProvider");
  return ctx;
}
