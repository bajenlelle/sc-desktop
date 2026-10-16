"use client";

import * as React from "react";

/**
 * Where floating UI (menus, tooltips, popovers, dialogs) mounts: the page
 * body normally. Inside an element in fullscreen it has to be that element,
 * because the browser shows only its subtree: the player provides itself
 * here while it is fullscreen.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: React.ReactNode;
}) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

/** The container for a Radix Portal's `container` prop (undefined = body). */
export function usePortalContainer(): HTMLElement | undefined {
  return React.useContext(PortalContainerContext) ?? undefined;
}
