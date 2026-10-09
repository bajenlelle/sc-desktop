"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { UserProfile } from "@scoutable/shared/types/org";
import { DeviceGate } from "@/components/device-gate";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";

/**
 * The tab bar steps aside for the watch view, which plays edge to edge as the
 * iOS app's player covers its tabs, and for joining a team: a focused task,
 * and for an account with no space yet the only page there is.
 */
function TabBarUnlessFocused() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === "/my-playlists" && searchParams.has("p")) return null;
  if (pathname === "/onboarding") return null;
  return <TabBar />;
}

/**
 * The signed-in app's frame: a sidebar beside the content from lg, a tab bar
 * under it below that. The window scrolls; each page brings its own toolbar
 * (shell/page.tsx). The device gate replaces only the content, so the
 * account stays reachable.
 */
export function AppShell({ profile, children }: { profile: UserProfile | null; children: React.ReactNode }) {
  return (
    <ShellProvider profile={profile}>
      <Sidebar />
      <main className="flex min-h-dvh flex-col lg:pl-[var(--sidebar-width)]">
        <DeviceGate>{children}</DeviceGate>
      </main>
      <Suspense fallback={<TabBar />}>
        <TabBarUnlessFocused />
      </Suspense>
    </ShellProvider>
  );
}
