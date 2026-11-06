"use client";

/**
 * A drawing as SVG and HTML, in the frame's pixels: the spotlight's dimming
 * with soft holes, the arrows with a dark halo under every line, and the
 * labels as pills. The geometry is shared (clip-drawing.ts), so the export's
 * canvas paints the same thing. The desktop draws the same component.
 */
import { motion } from "framer-motion";
import {
  arrowHead,
  arrowPolyline,
  DEFAULT_DRAWING_COLOR,
  DRAWING_COLORS,
  DRAWING_HALO,
  drawingMetrics,
  LABEL_BACKGROUND,
  LABEL_COLOR,
  LABEL_EM,
  pointsToPath,
  screenBar,
  shaftPolyline,
  SPOTLIGHT_DIM,
  SPOTLIGHT_SOFT_FROM,
  spotlightEllipse,
  zigzag,
  type DrawingMetrics,
  type DrawingShape,
} from "@scoutable/shared/lib/clip-drawing";

export type Frame = { width: number; height: number };
type Arrow = Extract<DrawingShape, { kind: "arrow" }>;

/** Each shape fades in after the one before it, in the order it was drawn. */
function fadeIn(i: number, animate: boolean) {
  return animate
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay: i * 0.08 } }
    : { initial: false as const, animate: { opacity: 1 } };
}

function ArrowPaths({ a, frame, m }: { a: Arrow; frame: Frame; m: DrawingMetrics }) {
  const color = DRAWING_COLORS[a.color ?? DEFAULT_DRAWING_COLOR];
  const line = arrowPolyline(a, frame);
  const head = arrowHead(line, m, a.arrow);
  const shaft = shaftPolyline(line, m, !!head);
  const d = pointsToPath(a.arrow === "dribble" ? zigzag(shaft, m) : shaft);
  const pass = a.arrow === "pass";
  const dash = pass ? `${m.dash[0]} ${m.dash[1]}` : undefined;
  const cap = pass ? "butt" : "round";
  const bar = a.arrow === "screen" ? screenBar(line, m) : null;
  const tri = head ? `${head.tip.x},${head.tip.y} ${head.left.x},${head.left.y} ${head.right.x},${head.right.y}` : null;
  return (
    <>
      <path d={d} fill="none" stroke={DRAWING_HALO} strokeWidth={m.halo} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} />
      {bar && <line x1={bar[0].x} y1={bar[0].y} x2={bar[1].x} y2={bar[1].y} stroke={DRAWING_HALO} strokeWidth={m.halo} strokeLinecap="round" />}
      {tri && <polygon points={tri} fill={DRAWING_HALO} stroke={DRAWING_HALO} strokeWidth={m.halo - m.stroke} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={color} strokeWidth={m.stroke} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} />
      {bar && <line x1={bar[0].x} y1={bar[0].y} x2={bar[1].x} y2={bar[1].y} stroke={color} strokeWidth={m.stroke} strokeLinecap="round" />}
      {tri && <polygon points={tri} fill={color} />}
    </>
  );
}

/**
 * The spotlights' dimming and the arrows. Each spotlight is its own mask,
 * nested, so overlapping holes stay holes.
 */
export function DrawingShapes({
  shapes,
  frame,
  animate,
  idPrefix,
}: {
  shapes: DrawingShape[];
  frame: Frame;
  animate: boolean;
  /** Unique per layer on the page: mask ids are document-wide. */
  idPrefix: string;
}) {
  const m = drawingMetrics(frame);
  const spots = shapes.flatMap((s, i) => (s.kind === "spotlight" ? [{ s, i }] : []));
  const prefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, "");
  let dim: React.ReactNode = <rect width={frame.width} height={frame.height} fill={SPOTLIGHT_DIM} />;
  spots.forEach((_, k) => {
    dim = <g mask={`url(#${prefix}-m${k})`}>{dim}</g>;
  });
  return (
    <svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className="absolute inset-0 overflow-visible"
      aria-hidden
    >
      {spots.length > 0 && (
        <>
          <defs>
            <radialGradient id={`${prefix}-soft`} cx="50%" cy="50%" r="50%">
              <stop offset={SPOTLIGHT_SOFT_FROM} stopColor="#000" />
              <stop offset="1" stopColor="#fff" />
            </radialGradient>
            {spots.map(({ s }, k) => {
              const e = spotlightEllipse(s as Extract<DrawingShape, { kind: "spotlight" }>, frame);
              return (
                <mask key={s.id} id={`${prefix}-m${k}`} maskUnits="userSpaceOnUse" x={0} y={0} width={frame.width} height={frame.height}>
                  <rect width={frame.width} height={frame.height} fill="#fff" />
                  <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={`url(#${prefix}-soft)`} />
                </mask>
              );
            })}
          </defs>
          <motion.g {...fadeIn(spots[0].i, animate)}>{dim}</motion.g>
        </>
      )}
      {shapes.map((s, i) =>
        s.kind === "arrow" ? (
          <motion.g key={s.id} {...fadeIn(i, animate)}>
            <ArrowPaths a={s} frame={frame} m={m} />
          </motion.g>
        ) : null,
      )}
    </svg>
  );
}

/** The labels: pills like the note's, centred on their points. The editor outlines the selected one. */
export function DrawingLabels({
  shapes,
  frame,
  animate,
  selectedId = null,
}: {
  shapes: DrawingShape[];
  frame: Frame;
  animate: boolean;
  selectedId?: string | null;
}) {
  const m = drawingMetrics(frame);
  return (
    <>
      {shapes.map((s, i) =>
        s.kind === "text" ? (
          <div
            key={s.id}
            className="absolute"
            style={{ left: s.at.x * frame.width, top: s.at.y * frame.height, transform: "translate(-50%, -50%)" }}
          >
            <motion.div
              {...fadeIn(i, animate)}
              className="font-bold whitespace-pre"
              style={{
                fontSize: m.labelFont,
                lineHeight: LABEL_EM.lineHeight,
                padding: `${LABEL_EM.padY}em ${LABEL_EM.padX}em`,
                borderRadius: `${LABEL_EM.radius}em`,
                background: LABEL_BACKGROUND,
                color: LABEL_COLOR,
                boxShadow: `inset 0 0 0 ${Math.max(1, m.stroke / 2)}px ${DRAWING_COLORS[s.color ?? DEFAULT_DRAWING_COLOR]}`,
                fontFamily: '"Scoutable Card", system-ui, sans-serif',
                ...(s.id === selectedId ? { outline: "1.5px dashed #fff", outlineOffset: 3 } : {}),
              }}
            >
              {s.text}
            </motion.div>
          </div>
        ) : null,
      )}
    </>
  );
}
