import { useLayoutEffect, useState } from "react";

/**
 * The stage as large as its column allows at 16:9: as wide as the column, unless the height left after
 * what sits under it (`underStage` px) is the tighter limit. A column dragged wider grows the footage
 * until the height runs out, and the footage never needs a scroll. Measures the box `ref` is put on,
 * from whenever that box is drawn (a page may draw it only once there is something to watch).
 */
export function useStageFit(underStage: number) {
  const [box, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      const h = box.clientHeight - underStage;
      setWidth(Math.max(240, Math.floor(Math.min(w, (h * 16) / 9))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, underStage]);
  return { ref, width };
}
