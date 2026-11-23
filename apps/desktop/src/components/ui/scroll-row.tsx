import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";

const FADE = "40px";

/**
 * A single row that scrolls sideways with no scrollbar: every item stays one
 * press away and nothing hides in a menu. The row fades at the edge where
 * more of it waits, and under the pointer a small ‹ or › sits in that fade
 * and moves the row a page, as a shelf in Music does: a chip that happens to
 * end at the edge no longer passes for the last one. A wheel turned up or
 * down scrolls it too. `data-more` says which edges fade ("start", "end" or
 * "both"; absent when everything fits). The props go to the scrolling row;
 * `frameClassName` places the row among its siblings (flex-1 in a toolbar).
 */
export function ScrollRow({
  className,
  frameClassName,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & { frameClassName?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [more, setMore] = React.useState<"start" | "end" | "both" | null>(null);
  const reduced = useReducedMotionSafe();

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore(start && end ? "both" : start ? "start" : end ? "end" : null);
  }, []);

  // When the row is resized, and after any render that may have changed what is in it.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  React.useEffect(measure);

  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(80, el.clientWidth - 80), behavior: reduced ? "auto" : "smooth" });
  };

  const mask =
    more === "both"
      ? `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`
      : more === "start"
        ? `linear-gradient(to right, transparent, black ${FADE})`
        : more === "end"
          ? `linear-gradient(to right, black calc(100% - ${FADE}), transparent)`
          : undefined;
  const atStart = more === "start" || more === "both";
  const atEnd = more === "end" || more === "both";

  return (
    <div className={cn("group/scroll relative min-w-0", frameClassName)}>
      <div
        {...props}
        ref={ref}
        data-more={more ?? undefined}
        onScroll={measure}
        onWheel={(e) => {
          const el = ref.current;
          if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
          el.scrollLeft += e.deltaY;
        }}
        style={{ ...style, maskImage: mask, WebkitMaskImage: mask, scrollbarWidth: "none" }}
        className={cn("flex items-center overflow-x-auto [&::-webkit-scrollbar]:hidden", className)}
      >
        {children}
      </div>
      {/* Pointer-only: the keyboard reaches every item by Tab, and the row follows focus. */}
      {atStart && <PageButton side="start" onClick={() => page(-1)} />}
      {atEnd && <PageButton side="end" onClick={() => page(1)} />}
    </div>
  );
}

function PageButton({ side, onClick }: { side: "start" | "end"; onClick: () => void }) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={side === "start" ? "Scroll back" : "Scroll for more"}
      data-scroll-page={side}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-separator outline-none transition-[opacity,background-color,color] duration-150 group-hover/scroll:opacity-100 hover:bg-fill-1 hover:text-foreground active:bg-fill-2 motion-reduce:transition-none",
        side === "start" ? "left-0" : "right-0",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
