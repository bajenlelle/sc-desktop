import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ColorThemeProvider } from "@/components/color-theme-provider";
import PostHogProvider from "@/components/posthog-provider";
import "./globals.css";

// Anti-flash: apply the stored color theme before first paint (next-themes'
// own inline script handles only the .dark class). Mirrors the slot keys in
// lib/prefs.ts and desktop's index.html boot script — keep in sync. Mode
// default is "system" to match ThemeProvider below (desktop defaults dark).
const themeBootScript = `(function () {
  try {
    var mode = localStorage.getItem("theme") || "system";
    if (mode === "system") {
      mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    var root = document.documentElement;
    var slot = mode === "dark" ? "scoutable_theme_dark" : "scoutable_theme_light";
    var theme = localStorage.getItem(slot);
    if (theme) root.dataset.theme = theme;
    var darkTheme = localStorage.getItem("scoutable_theme_dark");
    if (darkTheme) root.dataset.themeDark = darkTheme;
  } catch (e) {}
})();`;

export const metadata: Metadata = {
  metadataBase: new URL("https://app.scoutable.se"),
  title: "Scoutable",
  description: "Watch your team's playlists",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ColorThemeProvider>
            <PostHogProvider>{children}</PostHogProvider>
            <Toaster richColors />
          </ColorThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
