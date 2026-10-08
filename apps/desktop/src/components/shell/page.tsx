import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A content-column page: a `Toolbar` floats over the top of a `PageContent`
 * scroller whose content starts below it and scrolls under it. A one-pixel
 * sentinel at the top of the scroller tells the toolbar when something has
 * actually scrolled under it, so the material appears only then (an
 * IntersectionObserver, never a scroll listener).
 */
interface PageScrollState {
  scrolled: boolean;
  setScrolled: (next: boolean) => void;
}

const PageScrollContext = React.createContext<PageScrollState>({
  scrolled: false,
  setScrolled: () => {},
});

export function usePageScroll(): PageScrollState {
  return React.useContext(PageScrollContext);
}

export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);
  const value = React.useMemo(() => ({ scrolled, setScrolled }), [scrolled]);
  return (
    <PageScrollContext.Provider value={value}>
      <div className={cn("relative flex h-full min-h-0 flex-1 flex-col", className)}>{children}</div>
    </PageScrollContext.Provider>
  );
}

const WIDTHS = {
  narrow: "max-w-2xl",
  medium: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-none",
} as const;

export function PageContent({
  width = "wide",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: React.ReactNode;
}) {
  const { setScrolled } = usePageScroll();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { root: scroller, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [setScrolled]);

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      <div
        className={cn(
          "mx-auto w-full px-6 pb-10 pt-[calc(var(--toolbar-height)+0.75rem)]",
          WIDTHS[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
