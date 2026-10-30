/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "media",
  theme: {
    extend: {
      // Runtime-themed: every token resolves a CSS variable injected by
      // MobileThemeProvider (src/lib/theme-context.tsx) as an RGB triplet,
      // so `bg-primary/10`-style alpha modifiers keep working. The palette
      // per theme lives in @scoutable/shared/lib/themes THEME_TOKENS; the
      // default themes there equal the hexes that used to be hardcoded here.
      // No more `dark:*-dark` pairs — the provider swaps the variables when
      // the scheme or theme changes.
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        // The floor of grouped (settings) screens; equals background except in
        // light themes whose cards are the page colour (theme-derived.ts).
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        "primary-foreground": "rgb(var(--color-primary-foreground) / <alpha-value>)",
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        "muted-foreground": "rgb(var(--color-muted-foreground) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        destructive: "rgb(var(--color-destructive) / <alpha-value>)",
        popover: "rgb(var(--color-popover) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        // Derived per theme in @scoutable/shared/lib/theme-derived (the web's
        // color-mix formulas): already translucent, so no alpha modifier.
        "fill-1": "var(--color-fill-1)",
        "fill-2": "var(--color-fill-2)",
        "fill-3": "var(--color-fill-3)",
        "fill-4": "var(--color-fill-4)",
        separator: "var(--color-separator)",
        "separator-strong": "var(--color-separator-strong)",
        "material-toolbar": "var(--color-material-toolbar)",
        "material-popover": "var(--color-material-popover)",
      },
      // A bare `border` is a hairline in the separator colour, never currentColor.
      borderColor: {
        DEFAULT: "var(--color-separator)",
      },
      // The web app's radii (apps/web/src/app/globals.css: --radius 6) under
      // their web names, plus the names new code uses: controls 6 (buttons,
      // fields, pop-ups, segmented tracks), inner 4 (a segmented thumb inside a
      // control), window 10 (grouped lists, cards, callouts, toasts), sheet 14.
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "10px",
        inner: "4px",
        control: "6px",
        window: "10px",
        sheet: "14px",
      },
      // The web app's text styles at touch sizes (same names, sizes and
      // leading), set in Inter (src/lib/fonts.ts) with Inter's own
      // size-specific tracking (rsms's dynamic metrics: tighter as text grows,
      // near zero at 13 px). Weights: the large title, title 2 and the
      // headline are semibold (600), the calmer weights chosen for mobile v2.
      // Used through components/ui/Text, which also maps each weight to its
      // Inter file.
      fontSize: {
        "large-title": ["34px", { lineHeight: "41px", letterSpacing: "-0.022em", fontWeight: "600" }],
        "title-1": ["28px", { lineHeight: "34px", letterSpacing: "-0.021em", fontWeight: "400" }],
        "title-2": ["22px", { lineHeight: "28px", letterSpacing: "-0.018em", fontWeight: "600" }],
        "title-3": ["20px", { lineHeight: "25px", letterSpacing: "-0.017em", fontWeight: "600" }],
        headline: ["17px", { lineHeight: "22px", letterSpacing: "-0.013em", fontWeight: "600" }],
        body: ["17px", { lineHeight: "22px", letterSpacing: "-0.013em" }],
        callout: ["16px", { lineHeight: "21px", letterSpacing: "-0.011em" }],
        subheadline: ["15px", { lineHeight: "20px", letterSpacing: "-0.009em" }],
        footnote: ["13px", { lineHeight: "18px", letterSpacing: "-0.003em" }],
        caption: ["13px", { lineHeight: "18px", letterSpacing: "-0.003em", fontWeight: "500" }],
      },
    },
  },
};
