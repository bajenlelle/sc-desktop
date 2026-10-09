"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { UserProfile } from "@scoutable/shared/types/org";
import { DeviceGate } from "@/components/device-gate";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";

/** The watch view plays edge to edge: the tab bar steps aside, as the iOS app's player covers its tabs. */
function TabBarUnlessWatching() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === "/my-playlists" && searchParams.has("p")) return null;
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
        <TabBarUnlessWatching />
      </Suspense>
    </ShellProvider>
  );
}
