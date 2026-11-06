/**
 * A coach's drawing over the footage while the frame is held: fitted to the
 * 16:9 frame inside the stage (full screen may be wider or taller), under
 * the note's pill. Read only; the editor draws with DrawOverlay.
 */
import { useEffect, useId } from "react";
import type { DrawingShape } from "@scoutable/shared/lib/clip-drawing";
import { loadCardFonts } from "@/lib/card-painter";
import { useReducedMotionSafe } from "@/lib/motion";
import { DrawingLabels, DrawingShapes } from "./drawing-svg";
import { useFrameBox } from "./frame-box";

export function DrawingLayer({ shapes, animate = true }: { shapes: DrawingShape[]; animate?: boolean }) {
  const [ref, frame] = useFrameBox();
  const id = useId();
  const reduced = useReducedMotionSafe();
  // The export's font, so a label is as wide as in the file.
  useEffect(() => {
    void loadCardFonts().catch(() => {});
  }, []);
  const motion = animate && !reduced;
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[10]">
      {frame && shapes.length > 0 && (
        <div className="absolute inset-0 m-auto" style={{ width: frame.width, height: frame.height }}>
          <DrawingShapes shapes={shapes} frame={frame} animate={motion} idPrefix={`dl${id}`} />
          <DrawingLabels shapes={shapes} frame={frame} animate={motion} />
        </div>
      )}
    </div>
  );
}
