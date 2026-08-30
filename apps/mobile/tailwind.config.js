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
      // Hex conversions of apps/web/src/app/globals.css oklch tokens.
      // Use `bg-background dark:bg-background-dark` etc. — NativeWind has no
      // CSS-variable theming, so light/dark are explicit pairs.
      colors: {
        background: { DEFAULT: "#fcfcfc", dark: "#09131a" },
        foreground: { DEFAULT: "#020405", dark: "#d8dfe4" },
        card: { DEFAULT: "#fcfcfc", dark: "#121c23" },
        primary: { DEFAULT: "#0096b1", dark: "#00bcd8" },
        "primary-foreground": { DEFAULT: "#ffffff", dark: "#09131a" },
        secondary: { DEFAULT: "#f5f5f5", dark: "#202a32" },
        muted: { DEFAULT: "#f5f5f5", dark: "#202a32" },
        "muted-foreground": { DEFAULT: "#737373", dark: "#93999e" },
        accent: { DEFAULT: "#f19700", dark: "#f49a00" },
        destructive: { DEFAULT: "#e7000b", dark: "#ff6467" },
        border: { DEFAULT: "#e5e5e5", dark: "#2a343c" },
        input: { DEFAULT: "#e5e5e5", dark: "#2a343c" },
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
