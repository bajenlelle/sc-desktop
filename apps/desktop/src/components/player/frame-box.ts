import { useLayoutEffect, useRef, useState } from "react";

/**
 * The 16:9 frame inside a stage that may be wider or taller (full screen):
 * where object-contain puts the footage. The returned ref goes on an
 * element covering the stage; the frame follows its size.
 */
export function useFrameBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = Math.min(el.clientWidth, (el.clientHeight * 16) / 9);
      setFrame((prev) => (prev && prev.width === width ? prev : { width, height: (width * 9) / 16 }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, frame] as const;
}
