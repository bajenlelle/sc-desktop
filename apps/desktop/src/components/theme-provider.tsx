"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Follows the OS appearance by default, like every Apple app; Light and Dark
 * stay available in Settings and the View menu. `disableTransitionOnChange`
 * keeps a mode flip from tweening every colour transition in the app.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
