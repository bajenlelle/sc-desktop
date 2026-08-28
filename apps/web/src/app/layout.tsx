import type { Metadata } from "next";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import PostHogProvider from "@/components/posthog-provider";
import "./globals.css";

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
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <PostHogProvider>{children}</PostHogProvider>
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
