"use client";

import * as React from "react";
import { Columns2, Rows2 } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { EditorLayoutPref } from "@/lib/prefs";
import { cn } from "@/lib/utils";

/** From this width the owner may put the player across the top instead of beside the list. */
export const THEATER_MIN_PX = 1100;

/** Whether an element is at least `px` wide, kept current as it resizes (false before it exists). */
function useAtLeast(el: HTMLElement | null, px: number): boolean {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!el) return () => {};
      const observer = new ResizeObserver(notify);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [el],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => (el ? el.clientWidth >= px : false),
    () => false,
  );
}

/** Split (the list beside the player) or theater (the player across the top), for wide windows. */
export function EditorLayoutSwitch({ layout, onChange, className }: { layout: EditorLayoutPref; onChange: (next: EditorLayoutPref) => void; className?: string }) {
  return (
    <SegmentedControl<EditorLayoutPref>
      aria-label="Arrangement"
      value={layout}
      onValueChange={onChange}
      className={className}
      options={[
        { value: "split", label: "Split", icon: <Columns2 />, title: "The list beside the player" },
        { value: "theater", label: "Theater", icon: <Rows2 />, title: "The player across the top" },
      ]}
    />
  );
}

/**
 * The editor's two parts, arranged by the width of the column they are in
 * (a container query, so the sidebar's presence counts). Narrower than
 * 860 px the player sticks under the bar and the list scrolls beneath it,
 * the watch view's recipe; from 860 px they sit side by side with the list
 * in a fixed column; from 1100 px the owner may choose theater instead,
 * the player across the top and the list below.
 */
export function EditorLayout({
  layout,
  player,
  nowPlaying,
  listHeader,
  list,
  fullscreenLayer,
  onWideChange,
}: {
  layout: EditorLayoutPref;
  player: React.ReactNode;
  nowPlaying: React.ReactNode;
  listHeader: React.ReactNode;
  list: React.ReactNode;
  /** The player's full-window layer is up: its box must sit above the toolbar and the list. */
  fullscreenLayer: boolean;
  /** Whether the column is wide enough for theater, so the switch shows only when it applies. */
  onWideChange?: (wide: boolean) => void;
}) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  const wide = useAtLeast(el, THEATER_MIN_PX);
  const onWideChangeRef = React.useRef(onWideChange);
  React.useLayoutEffect(() => {
    onWideChangeRef.current = onWideChange;
  });
  React.useEffect(() => {
    onWideChangeRef.current?.(wide);
  }, [wide]);
  const theater = layout === "theater" && wide;

  return (
    <div ref={setEl} className="@container/editor pb-[calc(var(--tab-bar-height)+1.5rem)]">
      <div
        className={cn(
          "flex flex-col @min-[860px]/editor:px-6 @min-[860px]/editor:pt-1",
          theater ? "@min-[860px]/editor:gap-4" : "@min-[860px]/editor:flex-row @min-[860px]/editor:items-start @min-[860px]/editor:gap-6",
        )}
      >
        {/* The player and what's playing. Stacked, this box steps aside
            (display: contents) so the player's sticky range is the whole
            column, list included; side by side, it is the sticky column. */}
        <div
          className={cn(
            "contents @min-[860px]/editor:flex @min-[860px]/editor:min-w-0 @min-[860px]/editor:flex-col @min-[860px]/editor:gap-3",
            theater
              ? "@min-[860px]/editor:w-full"
              : "@min-[860px]/editor:sticky @min-[860px]/editor:top-[calc(var(--page-bar-height)+0.25rem)] @min-[860px]/editor:flex-1",
          )}
        >
          {/* Stacked, the player sticks under the bar while the list scrolls
              beneath it, and stops short of the screen's height. */}
          <div
            className={cn(
              // Above the rows (their contents sit at z-10), under the toolbar.
              "sticky top-[var(--page-bar-height)] z-20 bg-black @min-[860px]/editor:static @min-[860px]/editor:bg-transparent",
              fullscreenLayer && "z-[60]",
            )}
          >
            <div
              className={cn(
                "mx-auto w-full max-w-[calc(55dvh*16/9)]",
                theater
                  ? "@min-[860px]/editor:max-w-[calc((100dvh-var(--page-bar-height)-18rem)*16/9)]"
                  : "@min-[860px]/editor:max-w-[calc((100dvh-var(--page-bar-height)-14rem)*16/9)]",
              )}
            >
              {player}
            </div>
          </div>
          {nowPlaying}
        </div>

        {/* The list */}
        <div className={cn("flex min-w-0 flex-col", theater ? "@min-[860px]/editor:w-full" : "@min-[860px]/editor:w-[360px] @min-[860px]/editor:shrink-0")}>
          {listHeader}
          {list}
        </div>
      </div>
    </div>
  );
}
