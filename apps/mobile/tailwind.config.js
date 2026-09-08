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
      },
      borderRadius: {
        DEFAULT: "0.375rem",
      },
      fontFamily: {
        sans: ["DMSans_400Regular"],
        "sans-medium": ["DMSans_500Medium"],
        "sans-bold": ["DMSans_700Bold"],
        heading: ["BarlowCondensed_700Bold"],
        "heading-semi": ["BarlowCondensed_600SemiBold"],
      },
    },
  },
};
