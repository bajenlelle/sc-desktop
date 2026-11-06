/**
 * The coach's drawing on the footage while its frame is held, as the web
 * and the desktop draw it and the export burns it in: the spotlights'
 * dimming with soft holes (each its own mask, nested, so overlapping holes
 * stay holes), the arrows with a dark halo, the labels as pills. Fitted to
 * the 16:9 frame inside the stage like ClipCaption; the geometry is shared
 * (clip-drawing.ts). Fades in as a whole.
 */
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import Svg, { Defs, Ellipse, G, Line, Mask, Path, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
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
import { Text } from "@/components/ui/Text";

const fadeIn = FadeIn.duration(200).reduceMotion(ReduceMotion.Never);
const RATIO = 16 / 9;
type Frame = { width: number; height: number };
type Arrow = Extract<DrawingShape, { kind: "arrow" }>;
type Spotlight = Extract<DrawingShape, { kind: "spotlight" }>;

/** The largest 16:9 box that fits the stage: where the contained footage sits. */
function frameBox(stage: Frame): Frame {
  const width = Math.min(stage.width, stage.height * RATIO);
  return { width, height: width / RATIO };
}

function ArrowPaths({ a, frame, m }: { a: Arrow; frame: Frame; m: DrawingMetrics }) {
  const color = DRAWING_COLORS[a.color ?? DEFAULT_DRAWING_COLOR];
  const line = arrowPolyline(a, frame);
  const head = arrowHead(line, m, a.arrow);
  const shaft = shaftPolyline(line, m, !!head);
  const d = pointsToPath(a.arrow === "dribble" ? zigzag(shaft, m) : shaft);
  const pass = a.arrow === "pass";
  const dash = pass ? [m.dash[0], m.dash[1]] : undefined;
  const cap = pass ? "butt" : "round";
  const bar = a.arrow === "screen" ? screenBar(line, m) : null;
  const tri = head ? `${head.tip.x},${head.tip.y} ${head.left.x},${head.left.y} ${head.right.x},${head.right.y}` : null;
  return (
    <G>
      <Path d={d} fill="none" stroke={DRAWING_HALO} strokeWidth={m.halo} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} />
      {bar && <Line x1={bar[0].x} y1={bar[0].y} x2={bar[1].x} y2={bar[1].y} stroke={DRAWING_HALO} strokeWidth={m.halo} strokeLinecap="round" />}
      {tri && <Polygon points={tri} fill={DRAWING_HALO} stroke={DRAWING_HALO} strokeWidth={m.halo - m.stroke} strokeLinejoin="round" />}
      <Path d={d} fill="none" stroke={color} strokeWidth={m.stroke} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} />
      {bar && <Line x1={bar[0].x} y1={bar[0].y} x2={bar[1].x} y2={bar[1].y} stroke={color} strokeWidth={m.stroke} strokeLinecap="round" />}
      {tri && <Polygon points={tri} fill={color} />}
    </G>
  );
}

function Shapes({ shapes, frame }: { shapes: DrawingShape[]; frame: Frame }) {
  const m = drawingMetrics(frame);
  const spots = shapes.filter((s): s is Spotlight => s.kind === "spotlight");
  let dim: ReactNode = <Rect x={0} y={0} width={frame.width} height={frame.height} fill={SPOTLIGHT_DIM} />;
  spots.forEach((_, k) => {
    dim = <G mask={`url(#m${k})`}>{dim}</G>;
  });
  return (
    <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
      {spots.length > 0 && (
        <Defs>
          <RadialGradient id="soft" cx="50%" cy="50%" r="50%">
            <Stop offset={SPOTLIGHT_SOFT_FROM} stopColor="#000" />
            <Stop offset={1} stopColor="#fff" />
          </RadialGradient>
          {spots.map((s, k) => {
            const e = spotlightEllipse(s, frame);
            return (
              <Mask key={s.id} id={`m${k}`} maskUnits="userSpaceOnUse" x={0} y={0} width={frame.width} height={frame.height}>
                <Rect x={0} y={0} width={frame.width} height={frame.height} fill="#fff" />
                <Ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="url(#soft)" />
              </Mask>
            );
          })}
        </Defs>
      )}
      {spots.length > 0 && dim}
      {shapes.map((s) => (s.kind === "arrow" ? <ArrowPaths key={s.id} a={s} frame={frame} m={m} /> : null))}
    </Svg>
  );
}

/** Each label centred on its point: a frame-sized box around the point centres the pill without measuring it. */
function Labels({ shapes, frame }: { shapes: DrawingShape[]; frame: Frame }) {
  const m = drawingMetrics(frame);
  return (
    <>
      {shapes.map((s) =>
        s.kind === "text" ? (
          <View
            key={s.id}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: s.at.x * frame.width - frame.width / 2,
              top: s.at.y * frame.height - frame.height / 2,
              width: frame.width,
              height: frame.height,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                backgroundColor: LABEL_BACKGROUND,
                borderRadius: LABEL_EM.radius * m.labelFont,
                borderWidth: Math.max(1, m.stroke / 2),
                borderColor: DRAWING_COLORS[s.color ?? DEFAULT_DRAWING_COLOR],
                paddingHorizontal: LABEL_EM.padX * m.labelFont,
                paddingVertical: LABEL_EM.padY * m.labelFont,
              }}
            >
              <Text
                className="font-bold"
                numberOfLines={1}
                style={{ color: LABEL_COLOR, fontSize: m.labelFont, lineHeight: LABEL_EM.lineHeight * m.labelFont }}
              >
                {s.text}
              </Text>
            </View>
          </View>
        ) : null,
      )}
    </>
  );
}

export function DrawingLayer({ shapes }: { shapes: DrawingShape[] }) {
  const [stage, setStage] = useState<Frame | null>(null);
  const frame = stage ? frameBox(stage) : null;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) => setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {stage && frame && shapes.length > 0 && (
        <Animated.View
          entering={fadeIn}
          style={{
            position: "absolute",
            width: frame.width,
            height: frame.height,
            left: (stage.width - frame.width) / 2,
            top: (stage.height - frame.height) / 2,
          }}
        >
          <Shapes shapes={shapes} frame={frame} />
          <Labels shapes={shapes} frame={frame} />
        </Animated.View>
      )}
    </View>
  );
}
