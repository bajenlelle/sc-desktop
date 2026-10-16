"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { LicenseBanner } from "@/components/license-banner";

/**
 * A page in the content column. The window itself scrolls, so Safari's bars
 * still collapse and a tap on the status bar still scrolls to the top; the
 * page's `Toolbar` sticks to the top of it. A one-pixel sentinel at the very
 * top of the page tells the toolbar when anything has scrolled under it, so
 * its material appears only then (an IntersectionObserver, never a scroll
 * listener). `width` is the content's measure, shared with the toolbar's
 * large title so the two line up.
 */
const WIDTHS = {
  narrow: "max-w-2xl",
  medium: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-none",
} as const;

export type PageWidth = keyof typeof WIDTHS;

interface PageState {
  scrolled: boolean;
  width: PageWidth;
}

const PageContext = React.createContext<PageState>({ scrolled: false, width: "wide" });

export function usePage(): PageState {
  return React.useContext(PageContext);
}

export function pageWidthClass(width: PageWidth): string {
  return WIDTHS[width];
}

export function Page({
  width = "wide",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: React.ReactNode;
}) {
  const [scrolled, setScrolled] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const value = React.useMemo(() => ({ scrolled, width }), [scrolled, width]);
  return (
    <PageContext.Provider value={value}>
      <div className={cn("relative flex flex-1 flex-col", className)}>
        <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" />
        {children}
      </div>
    </PageContext.Provider>
  );
}

/**
 * The page's content, at the page's measure. It clears the tab bar at the
 * bottom, and opens with the active club's license notice when there is one.
 */
export function PageContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const { width } = usePage();
  return (
    <div
      className={cn(
        "mx-auto w-full flex-1 px-4 pt-2 pb-[calc(var(--tab-bar-height)+2.5rem)] sm:px-6 lg:pt-4",
        WIDTHS[width],
        className,
      )}
    >
      <LicenseBanner className="mb-5" />
      {children}
    </div>
  );
}
