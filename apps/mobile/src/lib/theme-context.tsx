/**
 * Mobile color-theme provider — the RN counterpart of desktop/web's
 * ColorThemeProvider + next-themes, in one place.
 *
 * NativeWind has no DOM to hang html[data-theme] selectors off, so theming
 * works the other way around: tailwind.config.js declares every color token
 * as `rgb(var(--color-*) / alpha)`, and this provider injects the variables
 * (RGB triplets from the shared THEME_TOKENS palette) via vars() on a root
 * View. vars() inheritance stops at native host boundaries — RN <Modal>
 * renders a separate native tree — so Modal contents re-anchor with
 * `useAppTheme().varsStyle` on their own wrapper View.
 *
 * The mode axis (light/dark/system) is nativewind's colorScheme.set, which
 * wraps Appearance.setColorScheme: `dark:` variants, RN useColorScheme, and
 * the auto StatusBar all follow. Slots + mode persist in AsyncStorage and
 * sync across devices via ThemeSync (same keys as desktop/web localStorage).
 *
 * setColorTheme = user pick (mode flip if needed + analytics); the adopt*
 * functions apply a synced value from another device without side effects —
 * ThemeSync's server ref keeps adoptions from echoing back as writes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme as nwColorScheme, useColorScheme, vars } from "nativewind";
import {
  DEFAULT_THEME,
  getTheme,
  hexToRgbTriplet,
  THEME_TOKENS,
  type MobileThemeTokens,
  type ThemeMode,
} from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import { trackEvent } from "@/lib/analytics";

const KEYS = {
  dark: "scoutable_theme_dark",
  light: "scoutable_theme_light",
  mode: "scoutable_theme_mode",
} as const;

interface AppThemeContextValue {
  /** Theme id currently applied (the slot for the resolved scheme). */
  activeThemeId: string;
  /** The remembered theme per mode — what ThemeSync watches and syncs. */
  slots: Record<ThemeMode, string>;
  /** The selected mode ("system" resolves against the OS per device). */
  modeSetting: ThemeModeSetting;
  /** Active palette as hexes, for JS-prop surfaces classes can't reach. */
  colors: MobileThemeTokens;
  /** vars() style of the active palette — re-anchor inside <Modal> trees. */
  varsStyle: Record<string, string>;
  setColorTheme: (id: string) => void;
  setModeSetting: (mode: ThemeModeSetting) => void;
  /** Sync adoption: apply + persist locally, nothing else. */
  adoptColorThemes: (prefs: { themeDark?: string; themeLight?: string }) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function isModeSetting(v: unknown): v is ThemeModeSetting {
  return v === "light" || v === "dark" || v === "system";
}

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<ThemeMode, string>>({
    dark: DEFAULT_THEME.dark,
    light: DEFAULT_THEME.light,
  });
  const [modeSetting, setModeSettingState] = useState<ThemeModeSetting>("system");

  // Hydrate persisted prefs. One default-palette frame on cold start is
  // accepted (the splash mostly covers it); storage failures fall through
  // to defaults, matching the app's AsyncStorage conventions.
  useEffect(() => {
    AsyncStorage.multiGet([KEYS.dark, KEYS.light, KEYS.mode])
      .then(([[, dark], [, light], [, mode]]) => {
        setSlots((prev) => ({
          dark: getTheme(dark)?.mode === "dark" ? (dark as string) : prev.dark,
          light: getTheme(light)?.mode === "light" ? (light as string) : prev.light,
        }));
        if (isModeSetting(mode)) setModeSettingState(mode);
      })
      .catch(() => {});
  }, []);

  // Project the selected mode onto Appearance (RN core; app.json already has
  // userInterfaceStyle "automatic"). "system" clears the override.
  useEffect(() => {
    nwColorScheme.set(modeSetting);
  }, [modeSetting]);

  const { colorScheme } = useColorScheme();
  const resolved: ThemeMode = colorScheme === "dark" ? "dark" : "light";

  const activeThemeId =
    getTheme(slots[resolved])?.mode === resolved ? slots[resolved] : DEFAULT_THEME[resolved];
  const colors = THEME_TOKENS[activeThemeId] ?? THEME_TOKENS[DEFAULT_THEME[resolved]];

  const varsStyle = useMemo(
    () =>
      vars({
        "--color-background": hexToRgbTriplet(colors.background),
        "--color-foreground": hexToRgbTriplet(colors.foreground),
        "--color-card": hexToRgbTriplet(colors.card),
        "--color-primary": hexToRgbTriplet(colors.primary),
        "--color-primary-foreground": hexToRgbTriplet(colors.primaryForeground),
        "--color-secondary": hexToRgbTriplet(colors.secondary),
        "--color-muted": hexToRgbTriplet(colors.muted),
        "--color-muted-foreground": hexToRgbTriplet(colors.mutedForeground),
        "--color-accent": hexToRgbTriplet(colors.accent),
        "--color-destructive": hexToRgbTriplet(colors.destructive),
        "--color-border": hexToRgbTriplet(colors.border),
        "--color-input": hexToRgbTriplet(colors.input),
      }),
    [colors],
  );

  const setModeSetting = useCallback((mode: ThemeModeSetting) => {
    setModeSettingState(mode);
    AsyncStorage.setItem(KEYS.mode, mode).catch(() => {});
  }, []);

  const setColorTheme = useCallback(
    (id: string) => {
      const theme = getTheme(id);
      if (!theme) return;
      setSlots((prev) => ({ ...prev, [theme.mode]: id }));
      AsyncStorage.setItem(KEYS[theme.mode], id).catch(() => {});
      if (resolved !== theme.mode) setModeSetting(theme.mode);
      trackEvent("color_theme_changed", { theme: id, mode: theme.mode });
    },
    [resolved, setModeSetting],
  );

  const adoptColorThemes = useCallback(
    (prefs: { themeDark?: string; themeLight?: string }) => {
      setSlots((prev) => {
        let next = prev;
        for (const [slotMode, id] of [
          ["dark", prefs.themeDark],
          ["light", prefs.themeLight],
        ] as const) {
          // Unknown/mode-mismatched ids (e.g. from a newer client) are
          // skipped; ThemeSync's raw ref ensures we never clobber them back.
          if (!id || getTheme(id)?.mode !== slotMode || prev[slotMode] === id) continue;
          AsyncStorage.setItem(KEYS[slotMode], id).catch(() => {});
          if (next === prev) next = { ...prev };
          next[slotMode] = id;
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      activeThemeId,
      slots,
      modeSetting,
      colors,
      varsStyle,
      setColorTheme,
      setModeSetting,
      adoptColorThemes,
    }),
    [activeThemeId, slots, modeSetting, colors, varsStyle, setColorTheme, setModeSetting, adoptColorThemes],
  );

  return (
    <AppThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, varsStyle]}>{children}</View>
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within MobileThemeProvider");
  return ctx;
}

/**
 * Drop-in successor of lib/theme.ts' `themeColors(useColorScheme())`: the
 * active theme's palette for navigator chrome, StatusBar, ActivityIndicator,
 * placeholderTextColor and other JS-prop surfaces.
 */
export function useThemeColors(): MobileThemeTokens {
  return useAppTheme().colors;
}
