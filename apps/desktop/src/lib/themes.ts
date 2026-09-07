/**
 * Color-theme registry — the single source of truth for the theme picker.
 *
 * Themes compose with (not replace) the light/dark mode axis owned by
 * next-themes: each theme is a complete palette tagged with the mode it
 * belongs to, and the user keeps one chosen theme per mode ("slots" in
 * prefs.ts). Token values live in src/themes.css as
 * `html[data-theme="<id>"]` blocks — every id here except the two defaults
 * must have a matching block there. The defaults deliberately have no CSS:
 * they ARE the base `:root`/`.dark` palettes in index.css, so users who
 * never touch the picker render exactly as before.
 *
 * `swatch` hexes are for the picker preview only (sRGB equivalents of the
 * oklch tokens); changing a theme's look means changing themes.css AND the
 * swatch together. All palettes were contrast-audited: text pairs >= 4.5:1.
 */

export type ThemeMode = "light" | "dark";

export interface ColorTheme {
  id: string;
  label: string;
  mode: ThemeMode;
  swatch: { bg: string; surface: string; primary: string; accent: string };
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "scoutable-dark",
    label: "Scoutable Dark",
    mode: "dark",
    swatch: { bg: "#09131A", surface: "#121C23", primary: "#00BCD8", accent: "#F49A00" },
  },
  {
    // Near-zero chroma everywhere, after DaVinci/Premiere: a tinted surround
    // biases how footage colors read in a dark room.
    id: "film-room",
    label: "Film Room",
    mode: "dark",
    swatch: { bg: "#1D1D1F", surface: "#252528", primary: "#38BDF8", accent: "#F59E0B" },
  },
  {
    id: "aubergine",
    label: "Aubergine",
    mode: "dark",
    swatch: { bg: "#221722", surface: "#2C1E2D", primary: "#CE93D8", accent: "#2EB67D" },
  },
  {
    id: "mocha",
    label: "Mocha",
    mode: "dark",
    swatch: { bg: "#1E1E2E", surface: "#252537", primary: "#89B4FA", accent: "#FAB387" },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatch: { bg: "#2E3440", surface: "#3B4252", primary: "#88C0D0", accent: "#EBCB8B" },
  },
  {
    id: "scoutable-light",
    label: "Scoutable Light",
    mode: "light",
    swatch: { bg: "#FCFCFC", surface: "#F5F5F5", primary: "#0096B1", accent: "#F19700" },
  },
  {
    id: "daylight",
    label: "Daylight",
    mode: "light",
    swatch: { bg: "#EFF1F5", surface: "#FFFFFF", primary: "#1A57D6", accent: "#DF8E1D" },
  },
  {
    id: "courtside",
    label: "Courtside",
    mode: "light",
    swatch: { bg: "#FAF4ED", surface: "#FFFAF3", primary: "#286983", accent: "#EA9D34" },
  },
];

export const DEFAULT_THEME: Record<ThemeMode, string> = {
  dark: "scoutable-dark",
  light: "scoutable-light",
};

export function getTheme(id: string | null | undefined): ColorTheme | undefined {
  return COLOR_THEMES.find((t) => t.id === id);
}
