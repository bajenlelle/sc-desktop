/**
 * Color-theme registry — the single source of truth for the theme pickers on
 * all three apps.
 *
 * Themes compose with (not replace) the light/dark mode axis: each theme is a
 * complete palette tagged with the mode it belongs to, and the user keeps one
 * chosen theme per mode ("slots", synced per user via profiles.theme_dark /
 * theme_light / theme_mode — see theme-sync.ts and themes-db.ts).
 *
 * Rendering is per platform:
 * - desktop: html[data-theme] CSS blocks in apps/desktop/src/themes.css
 * - web:     the same blocks copied to apps/web/src/app/themes.css
 * - mobile:  THEME_TOKENS below, injected as NativeWind vars() at runtime
 * The two default ids ("scoutable-dark"/"scoutable-light") deliberately have
 * NO CSS block — on desktop/web they are the base :root/.dark palettes, and
 * on mobile their THEME_TOKENS equal the pre-theming tailwind.config hexes —
 * so users who never touch a picker render exactly as before.
 *
 * `swatch` hexes are picker previews; `THEME_TOKENS` are mobile's actual
 * palette. Changing a theme's look means changing the CSS blocks AND these
 * hexes together (they are sRGB equivalents of the oklch tokens). All
 * palettes were contrast-audited: text pairs >= 4.5:1.
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

/**
 * Mobile palette per theme. Keys mirror apps/mobile/tailwind.config.js token
 * names (camelCased); the config's colors resolve `rgb(var(--color-*) / a)`
 * against vars() built from this map. The two default themes MUST stay equal
 * to the hexes that lived in tailwind.config.js before theming, so default
 * rendering is byte-stable. secondary/muted and border/input are aliases in
 * every palette, matching the CSS blocks.
 */
export interface MobileThemeTokens {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  destructive: string;
  border: string;
  input: string;
}

export const THEME_TOKENS: Record<string, MobileThemeTokens> = {
  "scoutable-dark": {
    background: "#09131a",
    foreground: "#d8dfe4",
    card: "#121c23",
    primary: "#00bcd8",
    primaryForeground: "#09131a",
    secondary: "#202a32",
    muted: "#202a32",
    mutedForeground: "#93999e",
    accent: "#f49a00",
    destructive: "#ff6467",
    border: "#2a343c",
    input: "#2a343c",
  },
  "film-room": {
    background: "#1d1d1f",
    foreground: "#e8e8ea",
    card: "#252528",
    primary: "#38bdf8",
    primaryForeground: "#1d1d1f",
    secondary: "#2c2c30",
    muted: "#2c2c30",
    mutedForeground: "#a3a3ab",
    accent: "#f59e0b",
    destructive: "#f87171",
    border: "#38383d",
    input: "#38383d",
  },
  aubergine: {
    background: "#221722",
    foreground: "#efe6ef",
    card: "#2c1e2d",
    primary: "#ce93d8",
    primaryForeground: "#221722",
    secondary: "#3a2a3b",
    muted: "#3a2a3b",
    mutedForeground: "#b6a3b7",
    accent: "#2eb67d",
    destructive: "#e8618c",
    border: "#443346",
    input: "#443346",
  },
  mocha: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    card: "#252537",
    primary: "#89b4fa",
    primaryForeground: "#1e1e2e",
    secondary: "#313244",
    muted: "#313244",
    mutedForeground: "#a6adc8",
    accent: "#fab387",
    destructive: "#f38ba8",
    border: "#45475a",
    input: "#45475a",
  },
  nord: {
    background: "#2e3440",
    foreground: "#eceff4",
    card: "#3b4252",
    primary: "#88c0d0",
    primaryForeground: "#2e3440",
    secondary: "#434c5e",
    muted: "#434c5e",
    mutedForeground: "#b7c0cd",
    accent: "#ebcb8b",
    destructive: "#e08a90",
    border: "#4c566a",
    input: "#4c566a",
  },
  "scoutable-light": {
    background: "#fcfcfc",
    foreground: "#020405",
    card: "#fcfcfc",
    primary: "#0096b1",
    primaryForeground: "#ffffff",
    secondary: "#f5f5f5",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    accent: "#f19700",
    destructive: "#e7000b",
    border: "#e5e5e5",
    input: "#e5e5e5",
  },
  daylight: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    card: "#ffffff",
    primary: "#1a57d6",
    primaryForeground: "#ffffff",
    secondary: "#e6e9ef",
    muted: "#e6e9ef",
    mutedForeground: "#5c5f77",
    accent: "#df8e1d",
    destructive: "#d20f39",
    border: "#ccd0da",
    input: "#ccd0da",
  },
  courtside: {
    background: "#faf4ed",
    foreground: "#575279",
    card: "#fffaf3",
    primary: "#286983",
    primaryForeground: "#ffffff",
    secondary: "#f2e9e1",
    muted: "#f2e9e1",
    mutedForeground: "#66627a",
    accent: "#ea9d34",
    destructive: "#a34d66",
    border: "#dfdad9",
    input: "#dfdad9",
  },
};

/**
 * "#rrggbb" -> "r g b" for Tailwind's `rgb(var(--x) / <alpha-value>)` shape,
 * which keeps opacity modifiers (bg-primary/10) working on mobile.
 */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
