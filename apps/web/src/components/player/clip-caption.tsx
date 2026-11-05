"use client";

/**
 * The coach's note on the footage: a pill in the top-left corner of the
 * 16:9 frame inside the stage, as the desktop editor shows it and the
 * export burns it in. The stage may be wider or taller than the footage
 * (full screen), so the frame box is fitted and centred here, and the
 * pill's size follows the frame's height (clip-caption.ts in shared holds
 * the geometry; a 12 px floor keeps it readable on a phone).
 */
import * as React from "react";
import { motion } from "framer-motion";
import type { CardAspect } from "@scoutable/shared/lib/card-layout";
import {
  CAPTION_BACKGROUND,
  CAPTION_COLOR,
  CAPTION_EM,
  CAPTION_FRACTIONS,
  CAPTION_MAX_LINES,
} from "@scoutable/shared/lib/clip-caption";
import { useReducedMotionSafe } from "@/lib/motion";

const RATIO: Record<CardAspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16 };
const MIN_FONT_PX = 12;

/** The largest box of this aspect that fits the stage: where object-contain puts the footage. */
function frameBox(stage: { width: number; height: number }, ratio: number): { width: number; height: number } {
  const width = Math.min(stage.width, stage.height * ratio);
  return { width, height: width / ratio };
}

export function ClipCaption({ text, aspect = "16:9" }: { text: string; aspect?: CardAspect }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState<{ width: number; height: number } | null>(null);
  const reduced = useReducedMotionSafe();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const trimmed = text.trim();
  const frame = stage ? frameBox(stage, RATIO[aspect]) : null;
  const f = CAPTION_FRACTIONS[aspect];
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[11]">
      {trimmed && frame && (
        <div className="absolute inset-0 m-auto" style={{ width: frame.width, height: frame.height }}>
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="absolute overflow-hidden font-semibold whitespace-pre-wrap [display:-webkit-box] [-webkit-box-orient:vertical]"
            style={{
              left: `${f.left * 100}%`,
              top: `${f.top * 100}%`,
              maxWidth: `${f.maxWidth * 100}%`,
              fontSize: Math.max(MIN_FONT_PX, frame.height * f.fontSize),
              lineHeight: CAPTION_EM.lineHeight,
              padding: `${CAPTION_EM.padY}em ${CAPTION_EM.padX}em`,
              borderRadius: `${CAPTION_EM.radius}em`,
              background: CAPTION_BACKGROUND,
              color: CAPTION_COLOR,
              overflowWrap: "anywhere",
              WebkitLineClamp: CAPTION_MAX_LINES,
            }}
          >
            {trimmed}
          </motion.div>
        </div>
      )}
    </div>
  );
}
