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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme as nwColorScheme, useColorScheme, vars } from "nativewind";
import {
  DEFAULT_THEME,
  getTheme,
  THEME_TOKENS,
  type MobileThemeTokens,
  type ThemeMode,
} from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import {
  deriveThemeColors,
  themeVarMap,
  type DerivedThemeColors,
} from "@scoutable/shared/lib/theme-derived";
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
  /** The web's derived colours for the active theme (fills, separators, status, materials). */
  derived: DerivedThemeColors;
  /** The scheme in effect after resolving "system". */
  resolvedMode: ThemeMode;
  /** vars() style of the active palette — re-anchor inside <Modal> trees. */
  varsStyle: Record<string, string>;
  /**
   * vars() style of the user's dark theme, for surfaces that are dark in both
   * modes (the player's chrome, its speed menu): the web's forced-dark island.
   */
  darkVarsStyle: Record<string, string>;
  /** The user's dark theme as plain colours, for JS props inside those surfaces. */
  darkColors: MobileThemeTokens & DerivedThemeColors;
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

  // Fields changed by a setter/adoption since mount. AsyncStorage hydration
  // resolves asynchronously and must never override a value that a sync
  // adoption (or an eager user pick) already applied — otherwise the stale
  // stored value would win AND get pushed back to the server by ThemeSync.
  const dirtyRef = useRef({ dark: false, light: false, mode: false });

  // Hydrate persisted prefs. One default-palette frame on cold start is
  // accepted (the splash mostly covers it); storage failures fall through
  // to defaults, matching the app's AsyncStorage conventions.
  useEffect(() => {
    AsyncStorage.multiGet([KEYS.dark, KEYS.light, KEYS.mode])
      .then(([[, dark], [, light], [, mode]]) => {
        setSlots((prev) => ({
          dark:
            !dirtyRef.current.dark && getTheme(dark)?.mode === "dark" ? (dark as string) : prev.dark,
          light:
            !dirtyRef.current.light && getTheme(light)?.mode === "light"
              ? (light as string)
              : prev.light,
        }));
        if (!dirtyRef.current.mode && isModeSetting(mode)) setModeSettingState(mode);
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
  const increasedContrast = useIncreasedContrast();
  const derived = useMemo(
    () => deriveThemeColors(activeThemeId, resolved, { increasedContrast }),
    [activeThemeId, resolved, increasedContrast],
  );

  const varsStyle = useMemo(() => vars(themeVarMap(colors, derived)), [colors, derived]);

  const darkThemeId = getTheme(slots.dark)?.mode === "dark" ? slots.dark : DEFAULT_THEME.dark;
  const darkColors = useMemo(
    () => ({
      ...(THEME_TOKENS[darkThemeId] ?? THEME_TOKENS[DEFAULT_THEME.dark]),
      ...deriveThemeColors(darkThemeId, "dark", { increasedContrast }),
    }),
    [darkThemeId, increasedContrast],
  );
  const darkVarsStyle = useMemo(() => vars(themeVarMap(darkColors, darkColors)), [darkColors]);

  const setModeSetting = useCallback((mode: ThemeModeSetting) => {
    dirtyRef.current.mode = true;
    setModeSettingState(mode);
    AsyncStorage.setItem(KEYS.mode, mode).catch(() => {});
  }, []);

  const setColorTheme = useCallback(
    (id: string) => {
      const theme = getTheme(id);
      if (!theme) return;
      dirtyRef.current[theme.mode] = true;
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
          // skipped; ThemeSync's unapplied mask ensures we never clobber
          // them back.
          if (!id || getTheme(id)?.mode !== slotMode || prev[slotMode] === id) continue;
          dirtyRef.current[slotMode] = true;
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
      derived,
      resolvedMode: resolved,
      varsStyle,
      darkVarsStyle,
      darkColors,
      setColorTheme,
      setModeSetting,
      adoptColorThemes,
    }),
    [
      activeThemeId,
      slots,
      modeSetting,
      colors,
      derived,
      resolved,
      varsStyle,
      darkVarsStyle,
      darkColors,
      setColorTheme,
      setModeSetting,
      adoptColorThemes,
    ],
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
 * The active theme's palette plus its derived colours, for navigator chrome,
 * StatusBar, ActivityIndicator, placeholderTextColor, SVG strokes and other
 * JS-prop surfaces classes can't reach.
 */
export function useThemeColors(): MobileThemeTokens & DerivedThemeColors {
  const { colors, derived } = useAppTheme();
  return useMemo(() => ({ ...colors, ...derived }), [colors, derived]);
}

/**
 * The system's Increase Contrast (iOS) or high-contrast text (Android)
 * setting; separators strengthen under it, as on the web.
 */
function useIncreasedContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read =
      Platform.OS === "ios"
        ? AccessibilityInfo.isDarkerSystemColorsEnabled()
        : AccessibilityInfo.isHighTextContrastEnabled();
    read.then(setOn).catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      Platform.OS === "ios" ? "darkerSystemColorsChanged" : "highTextContrastChanged",
      setOn,
    );
    return () => sub.remove();
  }, []);
  return on;
}
