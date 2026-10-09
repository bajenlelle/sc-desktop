"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { pageWidthClass, usePage } from "./page";
import { CompactSpaceSwitcher } from "./space-switcher";

const SCROLL_EDGE: React.CSSProperties = {
  WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 10px), transparent)",
  maskImage: "linear-gradient(to bottom, black calc(100% - 10px), transparent)",
};

/**
 * The page's toolbar, stuck to the top of the window: transparent while the
 * page sits at the top, a translucent material with a soft lower edge once
 * content passes under it (the scroll-edge effect, instead of a line).
 *
 * Beside the sidebar (lg and up) it is desktop's bar: the title, `principal`
 * centred (a view switcher, as in Calendar's Day/Week/Month), `search` and
 * `actions` on the right.
 *
 * On narrower screens it is iOS's navigation bar: the space (or the page's
 * `leading`, such as a back button) on the left, `actions` on the right, and
 * a large title under the bar that scrolls away and hands over to a small
 * centred title as it passes under the bar. `principal` and `search` sit
 * under the large title there, so they render twice, one copy showing per
 * width: pass controlled elements. `inline` pages (details reached from
 * another page) keep the small title in the bar instead.
 */
export function Toolbar({
  title,
  subtitle,
  leading,
  principal,
  search,
  actions,
  inline = false,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  principal?: React.ReactNode;
  search?: React.ReactNode;
  actions?: React.ReactNode;
  inline?: boolean;
  className?: string;
}) {
  const { scrolled, width } = usePage();
  const barRef = React.useRef<HTMLElement>(null);
  const largeTitleRef = React.useRef<HTMLHeadingElement>(null);
  const [titleUnderBar, setTitleUnderBar] = React.useState(false);

  // The small title appears once the large one has gone under the bar. The
  // observer's top edge is the bar's bottom edge, re-measured whenever the
  // bar changes height (safe area, rotation, the lg breakpoint).
  React.useEffect(() => {
    const bar = barRef.current;
    const heading = largeTitleRef.current;
    if (!bar || !heading) return;
    let observer: IntersectionObserver | undefined;
    const watch = () => {
      observer?.disconnect();
      const barHeight = bar.offsetHeight;
      observer = new IntersectionObserver(
        ([entry]) => setTitleUnderBar(!entry.isIntersecting && entry.boundingClientRect.top < barHeight),
        { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(heading);
    };
    watch();
    const resize = new ResizeObserver(watch);
    resize.observe(bar);
    return () => {
      observer?.disconnect();
      resize.disconnect();
    };
  }, [inline]);

  const smallTitleShown = inline || titleUnderBar;

  return (
    <>
      <header
        ref={barRef}
        data-scrolled={scrolled ? "true" : undefined}
        className={cn(
          "sticky top-0 z-30 shrink-0 pt-[var(--safe-top)] transition-[background-color] duration-200",
          scrolled ? "bg-material-toolbar backdrop-blur-xl" : "bg-transparent",
          className,
        )}
        style={scrolled ? SCROLL_EDGE : undefined}
      >
        <div className="relative flex h-11 items-center gap-2 px-4 sm:px-6 lg:h-[var(--toolbar-height)] lg:gap-3 lg:pr-4">
          {/* Left and right share the bar equally so the small title sits in
              the middle; a side whose items need more takes it, and the
              title gives way (it is the only part that shrinks). */}
          {/* Left: the space or the page's leading item; the title from lg. */}
          <div className="flex flex-1 basis-0 items-center gap-1 lg:min-w-0 lg:flex-initial lg:basis-auto lg:gap-3">
            {leading ?? (
              <span className="lg:hidden">
                <CompactSpaceSwitcher />
              </span>
            )}
            <div className="hidden min-w-0 items-baseline gap-2 lg:flex">
              <h1 className="truncate text-title-3 text-foreground">{title}</h1>
              {subtitle && <span className="truncate text-subheadline text-muted-foreground nums">{subtitle}</span>}
            </div>
          </div>

          {/* Centre, narrow screens: the small title. */}
          <div
            aria-hidden={!inline || undefined}
            className={cn(
              "min-w-0 max-w-[55%] text-center transition-opacity duration-200 lg:hidden",
              smallTitleShown ? "opacity-100" : "opacity-0",
            )}
          >
            {inline ? (
              <h1 className="truncate text-headline text-foreground">{title}</h1>
            ) : (
              <p className="truncate text-headline text-foreground">{title}</p>
            )}
          </div>

          {/* Centre, lg: the principal item, centred on the bar itself so it
              never shifts as the items beside it come and go. */}
          {principal && (
            <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-center lg:flex">
              <div className="pointer-events-auto">{principal}</div>
            </div>
          )}

          {/* Right: search from lg, then the actions. */}
          <div className="flex flex-1 basis-0 items-center justify-end gap-2 lg:basis-auto">
            {search && <div className="hidden w-48 shrink-0 lg:block xl:w-56">{search}</div>}
            {actions && <div className="flex shrink-0 items-center gap-1 lg:gap-2">{actions}</div>}
          </div>
        </div>
      </header>

      {!inline && (
        <div className={cn("mx-auto w-full px-4 pt-1 pb-2 sm:px-6 lg:hidden", pageWidthClass(width))}>
          <h1 ref={largeTitleRef} className="text-large-title font-bold text-foreground">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-subheadline text-muted-foreground nums">{subtitle}</p>}
          {(search || principal) && (
            <div className="mt-3 flex flex-col gap-2.5">
              {search}
              {/* Full width, as iOS lays out a scope bar. */}
              {principal && <div className="flex *:flex-1 [&>*>*]:flex-1">{principal}</div>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
