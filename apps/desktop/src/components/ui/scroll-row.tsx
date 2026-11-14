import * as React from "react";
import { cn } from "@/lib/utils";

const FADE = "24px";

/**
 * A single row that scrolls sideways with no scrollbar: every item stays one
 * press away and nothing hides in a menu. The row fades at the edge where
 * more of it waits, so an item cut by the edge reads as "there is more", and
 * a wheel turned up or down scrolls it too. `data-more` says which edges fade
 * ("start", "end" or "both"; absent when everything fits).
 */
export function ScrollRow({ className, style, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [more, setMore] = React.useState<"start" | "end" | "both" | null>(null);

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

  const mask =
    more === "both"
      ? `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`
      : more === "start"
        ? `linear-gradient(to right, transparent, black ${FADE})`
        : more === "end"
          ? `linear-gradient(to right, black calc(100% - ${FADE}), transparent)`
          : undefined;

  return (
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
  );
}
