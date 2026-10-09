/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
    // eventColors() in shared returns Tailwind class strings — keep them from being purged
    "../../packages/shared/lib/events.ts",
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
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        "primary-foreground": "rgb(var(--color-primary-foreground) / <alpha-value>)",
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        "muted-foreground": "rgb(var(--color-muted-foreground) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        destructive: "rgb(var(--color-destructive) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        input: "rgb(var(--color-input) / <alpha-value>)",
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
      // The web app's radii (apps/web/src/app/globals.css: --radius 6).
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "10px",
        window: "10px",
        sheet: "14px",
      },
      // The web app's text styles at touch sizes (system font; iOS applies
      // SF's tracking itself). Used through components/ui/Text.
      fontSize: {
        "large-title": ["34px", { lineHeight: "41px", fontWeight: "700" }],
        "title-1": ["28px", { lineHeight: "34px", fontWeight: "400" }],
        "title-2": ["22px", { lineHeight: "28px", fontWeight: "700" }],
        "title-3": ["20px", { lineHeight: "25px", fontWeight: "600" }],
        headline: ["17px", { lineHeight: "22px", fontWeight: "700" }],
        body: ["17px", { lineHeight: "22px" }],
        callout: ["16px", { lineHeight: "21px" }],
        subheadline: ["15px", { lineHeight: "20px" }],
        footnote: ["13px", { lineHeight: "18px" }],
        caption: ["13px", { lineHeight: "18px", fontWeight: "500" }],
      },
    },
  },
};
