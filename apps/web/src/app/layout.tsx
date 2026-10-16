import type { Metadata, Viewport } from "next";
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
  // Safari on iPhone turns emails, numbers and dates into links by wrapping
  // them in elements of its own, inside text React owns; React then fails to
  // update that text (see lib/sign-out.ts). Clock times and scores read as
  // phone numbers to it, too.
  formatDetection: { telephone: false, email: false, address: false, date: false },
};

// Edge to edge on phones (the shell pads for the notch and home indicator
// itself); the browser chrome takes the default background of each mode.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#09131a" },
  ],
};

/**
 * Toasts in the active theme's colours (sonner's own palette is light-only
 * and ignores the colour themes), bottom centre, clear of the phone tab bar.
 */
function ThemedToaster() {
  return (
    <Toaster
      position="bottom-center"
      duration={4000}
      offset={{ bottom: "calc(var(--tab-bar-height) + 24px)" }}
      mobileOffset={{ bottom: "calc(var(--tab-bar-height) + 12px)" }}
      toastOptions={{
        style: {
          background: "var(--popover)",
          border: "none",
          boxShadow: "var(--shadow-menu)",
          borderRadius: "10px",
          color: "var(--foreground)",
        },
      }}
    />
  );
}

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
            <ThemedToaster />
          </ColorThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
