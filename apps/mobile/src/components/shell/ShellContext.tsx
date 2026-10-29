import { createContext, useContext, type ReactNode } from "react";

/**
 * What a screen needs to know about the chrome around it: how tall the tab
 * bar is (0 for screens that sit above the tabs: watch, team, sheets), so
 * scroll content and floating things clear it.
 */
interface Shell {
  tabBarHeight: number;
}

const ShellContext = createContext<Shell>({ tabBarHeight: 0 });

export function ShellProvider({ tabBarHeight, children }: { tabBarHeight: number; children: ReactNode }) {
  return <ShellContext.Provider value={{ tabBarHeight }}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  return useContext(ShellContext);
}
