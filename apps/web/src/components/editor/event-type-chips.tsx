"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { FilterOption } from "@scoutable/shared/lib/clip-filters";
import { cn } from "@/lib/utils";

/** A made/miss dot on each chip, so the row scans before it is read. */
function outcomeTone(value: string): string {
  if (value.endsWith("-made")) return "bg-emerald-500";
  if (value.endsWith("-miss")) return "bg-rose-500";
  return "bg-muted-foreground/50";
}

/**
 * The event-type filter as a single row of chips that scrolls sideways:
 * every option is visible and one press away, nothing hides in a menu.
 * The edges fade where there is more to scroll.
 */
export function EventTypeChips({
  options,
  selected,
  onChange,
  className,
}: {
  options: readonly FilterOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  React.useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const mask =
    edges.left && edges.right
      ? "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)"
      : edges.left
        ? "linear-gradient(to right, transparent, black 24px)"
        : edges.right
          ? "linear-gradient(to right, black calc(100% - 24px), transparent)"
          : undefined;

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Event type"
      onScroll={measure}
      onWheel={(e) => {
        const el = ref.current;
        if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        el.scrollLeft += e.deltaY;
      }}
      style={{ maskImage: mask, WebkitMaskImage: mask, scrollbarWidth: "none" }}
      className={cn("flex items-center gap-1.5 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden", className)}
    >
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-1 hover:text-foreground active:scale-95 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:h-9"
        >
          <X className="size-3" />
          Clear
        </button>
      )}
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,transform,box-shadow] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background pointer-coarse:h-9 pointer-coarse:px-3.5",
              on ? "bg-selection text-selection-foreground" : "bg-card text-foreground ring-1 ring-separator hover:bg-fill-1 active:bg-fill-2",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-white/80" : outcomeTone(o.value))} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
