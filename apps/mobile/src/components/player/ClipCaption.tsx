/**
 * The coach's note on the footage: a pill in the top-left corner of the
 * 16:9 frame, as the web and the desktop draw it and the export burns it
 * in. The stage is measured and the frame box fitted inside it (the video
 * is shown contained), and the pill's size follows the frame's height
 * (clip-caption.ts in shared holds the geometry; a 12 pt floor keeps it
 * readable in the portrait stage).
 */
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import {
  CAPTION_BACKGROUND,
  CAPTION_COLOR,
  CAPTION_EM,
  CAPTION_MAX_LINES,
  captionLayout,
} from "@scoutable/shared/lib/clip-caption";
import { Text } from "@/components/ui/Text";

const fadeIn = FadeIn.duration(150).reduceMotion(ReduceMotion.Never);
const RATIO = 16 / 9;
const MIN_FONT = 12;

/** The largest 16:9 box that fits the stage: where the contained footage sits. */
function frameBox(stage: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(stage.width, stage.height * RATIO);
  return { width, height: width / RATIO };
}

export function ClipCaption({ text }: { text: string }) {
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const trimmed = text.trim();
  if (!trimmed) return null;
  const frame = stage ? frameBox(stage) : null;
  const l = frame ? captionLayout("16:9", frame) : null;
  const font = l ? Math.max(MIN_FONT, l.fontSize) : MIN_FONT;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) =>
        setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      {stage && frame && l && (
        <View
          style={{
            position: "absolute",
            width: frame.width,
            height: frame.height,
            left: (stage.width - frame.width) / 2,
            top: (stage.height - frame.height) / 2,
          }}
        >
          <Animated.View
            entering={fadeIn}
            style={{
              position: "absolute",
              left: l.left,
              top: l.top,
              maxWidth: l.maxWidth,
              backgroundColor: CAPTION_BACKGROUND,
              borderRadius: font * CAPTION_EM.radius,
              paddingHorizontal: font * CAPTION_EM.padX,
              paddingVertical: font * CAPTION_EM.padY,
            }}
          >
            <Text
              numberOfLines={CAPTION_MAX_LINES}
              className="font-bold"
              style={{ color: CAPTION_COLOR, fontSize: font, lineHeight: font * CAPTION_EM.lineHeight }}
            >
              {trimmed}
            </Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}
