/**
 * A playlist card on the watch screen's stage, over the black frame the
 * export uses. A stats card is drawn with the export's hierarchy
 * (lib/card-layout.ts): the player, their number and team, the game or the
 * season, a row of numbers over their labels, and the coach's note. A text
 * card is its words, as large as the frame allows.
 *
 * The stage is a picture, like the video: it is sized from its own width
 * (larger in full screen) and does not follow the system text size; its
 * words reach VoiceOver as one label.
 */
import { useState } from "react";
import { Text as RNText, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { CARD_BACKGROUND } from "@scoutable/shared/lib/card-layout";
import { cardContent, cardRowSummary, type CardContent } from "@scoutable/shared/lib/stats-card";
import type { PlaylistTextCard } from "@scoutable/shared/types/match";
import { interStyle, type FontWeight } from "@/lib/fonts";

const fadeIn = FadeIn.duration(150).reduceMotion(ReduceMotion.Never);

/** The upright stage's width, where the sizes below are 1×. */
const BASE_WIDTH = 402;
const MAX_SCALE = 1.7;

/** Bold tabular digits are about this wide, in em. */
const DIGIT_EM = 0.62;

function StageText({
  size,
  weight = 400,
  color = "#ffffff",
  nums,
  style,
  ...props
}: {
  size: number;
  weight?: FontWeight;
  color?: string;
  nums?: boolean;
  style?: TextStyle;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  children: React.ReactNode;
}) {
  return (
    <RNText
      allowFontScaling={false}
      style={[
        interStyle(weight),
        { fontSize: size, lineHeight: Math.round(size * 1.25), color, textAlign: "center" },
        nums ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
      {...props}
    />
  );
}

function StatsCardView({ content, scale, width, fullscreen }: { content: CardContent; scale: number; width: number; fullscreen: boolean }) {
  const pad = 20 * scale;
  const inner = width - 2 * pad;
  const cells = content.cells;
  // One size for every number, the largest at which the longest fits its cell.
  const cellWidth = cells.length > 0 ? inner / cells.length : inner;
  const longest = Math.max(1, ...cells.map((c) => c.value.length));
  const valueSize = Math.min(30 * scale, (cellWidth * 0.86) / (longest * DIGIT_EM));
  return (
    <View style={{ width: "100%", paddingHorizontal: pad, alignItems: "center" }}>
      <StageText size={22 * scale} weight={700} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {content.heading}
      </StageText>
      {content.details ? (
        <StageText size={13 * scale} color="rgba(255,255,255,0.7)" numberOfLines={1} style={{ marginTop: 3 * scale }}>
          {content.details}
        </StageText>
      ) : null}
      {content.context ? (
        <StageText size={12 * scale} color="rgba(255,255,255,0.55)" numberOfLines={1} style={{ marginTop: 1 * scale }}>
          {content.context}
        </StageText>
      ) : null}
      {cells.length > 0 ? (
        <View style={{ flexDirection: "row", alignSelf: "stretch", justifyContent: "center", marginTop: 14 * scale }}>
          {cells.map((c) => (
            <View key={c.label} style={{ width: cellWidth, maxWidth: 96 * scale, alignItems: "center" }}>
              <StageText size={valueSize} weight={700} nums numberOfLines={1} style={{ lineHeight: Math.round(valueSize * 1.15) }}>
                {c.value}
              </StageText>
              <StageText
                size={10.5 * scale}
                weight={600}
                color="rgba(255,255,255,0.6)"
                numberOfLines={1}
                style={{ letterSpacing: 0.6 * scale, marginTop: 1 * scale }}
              >
                {c.label}
              </StageText>
            </View>
          ))}
        </View>
      ) : null}
      {content.note ? (
        <StageText
          size={13 * scale}
          color="rgba(255,255,255,0.85)"
          numberOfLines={fullscreen ? 3 : 2}
          style={{ marginTop: 12 * scale, maxWidth: 520 * scale }}
        >
          {content.note.replace(/\n{2,}/g, "\n")}
        </StageText>
      ) : null}
    </View>
  );
}

/** Semibold Inter averages about this wide per character, in em. */
const TEXT_EM = 0.55;
const TEXT_LEADING = 1.22;

/**
 * The largest size, from the card's own down to a floor, at which the
 * words wrapped to the frame's width fill no more than its height: a short
 * line stays large, a long one shrinks only as far as it must.
 */
function fitTextSize(text: string, max: number, min: number, width: number, height: number): number {
  const paragraphs = text.split("\n");
  const linesAt = (px: number) =>
    paragraphs.reduce((n, p) => n + Math.max(1, Math.ceil((p.trim().length * TEXT_EM * px) / width)), 0);
  let px = max;
  while (px > min && linesAt(px) * px * TEXT_LEADING > height) px -= 1;
  return px;
}

function TextCardView({ text, scale, size }: { text: string; scale: number; size: { width: number; height: number } }) {
  const padX = 28 * scale;
  const padY = 20 * scale;
  const width = Math.min(size.width, 680 * scale) - 2 * padX;
  const height = size.height - 2 * padY;
  const px = fitTextSize(text, 26 * scale, 11, width, height);
  return (
    <View style={{ width: width + 2 * padX, paddingHorizontal: padX, paddingVertical: padY }}>
      <StageText
        size={px}
        weight={600}
        // The estimate errs both ways; iOS shrinks what still overflows.
        numberOfLines={Math.max(1, Math.floor(height / (px * TEXT_LEADING)))}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ lineHeight: Math.round(px * TEXT_LEADING), letterSpacing: px >= 20 ? -0.3 * scale : 0 }}
      >
        {text}
      </StageText>
    </View>
  );
}

export function CardStage({ card, fullscreen }: { card: PlaylistTextCard; fullscreen: boolean }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const scale = size ? Math.min(MAX_SCALE, Math.max(1, size.width / BASE_WIDTH)) : 1;
  const text = card.text.trim();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={cardRowSummary(card).label}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: CARD_BACKGROUND }}
      onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {size && (
        <Animated.View entering={fadeIn} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {card.card ? (
            <StatsCardView content={cardContent(card.card)} scale={scale} width={size.width} fullscreen={fullscreen} />
          ) : (
            <TextCardView text={text} scale={scale} size={size} />
          )}
        </Animated.View>
      )}
    </View>
  );
}
