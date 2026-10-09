/**
 * The colours the web derives in CSS (apps/web/src/app/globals.css), computed
 * for the mobile app from each theme's THEME_TOKENS. The web writes them as
 * `color-mix(in oklab, X p%, transparent)`, which is exactly X at alpha p, so
 * each one is a base colour at a fixed alpha:
 *
 * - fills (hover/press and recessed surfaces): foreground at 5/8/12/18%
 * - separators: foreground at 10% (18% under Increase Contrast)
 * - selection: the primary colour
 * - materials (translucent chrome): background at 72%, popover at 88%
 *
 * Success and warning are set per mode, not per theme, as on the web.
 */
import { DEFAULT_THEME, THEME_TOKENS, getTheme, type ThemeMode } from "./themes";

export interface DerivedThemeColors {
  popover: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  fill1: string;
  fill2: string;
  fill3: string;
  fill4: string;
  separator: string;
  separatorStrong: string;
  selection: string;
  selectionForeground: string;
  materialToolbar: string;
  materialPopover: string;
}

const STATUS: Record<ThemeMode, Pick<DerivedThemeColors, "success" | "successForeground" | "warning" | "warningForeground">> = {
  light: { success: "#168b49", successForeground: "#ffffff", warning: "#c46d00", warningForeground: "#ffffff" },
  dark: { success: "#5bcc80", successForeground: "#09131a", warning: "#f5ae4b", warningForeground: "#09131a" },
};

/**
 * Menus and sheets use `popover`, which equals `card` except in these two
 * themes (themes.css: oklch(0.287 0.007 285.9) and oklch(0.324 0.032 282)).
 * Kept here so THEME_TOKENS stays the 12 tokens its registry test pins.
 */
const POPOVERS: Record<string, string> = {
  "film-room": "#2a2a2e",
  mocha: "#313244",
};

/** "#rrggbb" at an alpha, as an rgba() string React Native understands. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Derived colours for a theme id; an unknown id falls back to the mode's default theme. */
export function deriveThemeColors(
  themeId: string,
  mode: ThemeMode,
  opts: { increasedContrast?: boolean } = {},
): DerivedThemeColors {
  const id = getTheme(themeId)?.mode === mode ? themeId : DEFAULT_THEME[mode];
  const tokens = THEME_TOKENS[id];
  const popover = POPOVERS[id] ?? tokens.card;
  const separatorStrong = rgba(tokens.foreground, 0.18);
  return {
    popover,
    ...STATUS[mode],
    fill1: rgba(tokens.foreground, 0.05),
    fill2: rgba(tokens.foreground, 0.08),
    fill3: rgba(tokens.foreground, 0.12),
    fill4: rgba(tokens.foreground, 0.18),
    separator: opts.increasedContrast ? separatorStrong : rgba(tokens.foreground, 0.1),
    separatorStrong,
    selection: tokens.primary,
    selectionForeground: tokens.primaryForeground,
    materialToolbar: rgba(tokens.background, 0.72),
    materialPopover: rgba(popover, 0.88),
  };
}
