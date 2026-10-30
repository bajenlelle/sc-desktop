/**
 * The footage with its controls over it (the web's player-stage.tsx). The
 * controls are one floating glass bar at the bottom of the footage, upright
 * and in full screen alike: the timeline over previous, play and next, the
 * clip's place in the queue, speed and full screen (the wider stage adds
 * replay and stop). A text card has no timeline, so the bar shrinks to its
 * buttons and leaves the words clear. A tap shows or hides the bar (it never
 * pauses); it stays while paused and fades after a moment of stillness
 * during playback. A spinner shows while the decoder is behind, and what
 * went wrong when nothing can play.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useLargeText } from "@/lib/a11y";
import { VideoView, type VideoPlayer } from "expo-video";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { ClipProgress, ClipScrubber } from "./ClipScrubber";
import { ControlButton, ControlRow, FullscreenButton, PlayPauseButton, PlayerMaterial, SpeedMenu } from "./controls";

const IDLE_MS = 2500;
/** Narrower than this, the bar leaves out replay and stop. */
const COMPACT_WIDTH = 560;

const fadeIn = FadeIn.duration(200).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(200).reduceMotion(ReduceMotion.Never);

export interface Transport {
  isQueueActive: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onStop: () => void;
}

export function PlayerStage({
  player,
  duration,
  canScrub = true,
  paused,
  onTogglePlay,
  transport,
  speed,
  onSpeedChange,
  fullscreen,
  title,
  position,
  buffering,
  failed,
  idleLabel,
  cardShowing,
  onScrubbingChange,
  children,
}: {
  player: VideoPlayer;
  /** The playing clip's length; no timeline without one (or during a text card). */
  duration: number | null;
  /** False for a viewer who may not drag the timeline (a player): a read-only progress line instead. */
  canScrub?: boolean;
  /** What the controls show: the footage's state, or a text card's. */
  paused: boolean;
  onTogglePlay: () => void;
  transport: Transport;
  speed: number;
  onSpeedChange: (speed: number) => void;
  fullscreen: { active: boolean; toggle: () => void; exit: () => void };
  /** Full-screen top bar. */
  title?: string;
  position?: { index: number; total: number } | null;
  buffering: boolean;
  failed: boolean;
  /** Nothing playing yet: the wide layout's centre button ("Play", "Resume"). */
  idleLabel?: string | null;
  /** A text card is up (it has no timeline, so the bar is only its buttons). */
  cardShowing?: boolean;
  onScrubbingChange?: (scrubbing: boolean) => void;
  /** Overlays on the footage (a text card). Taps pass through them. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const largeText = useLargeText();
  const [width, setWidth] = useState(0);
  const compact = width > 0 && width < COMPACT_WIDTH;
  const [awake, setAwake] = useState(true);
  const [activity, setActivity] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);

  // The controls fade after a moment of stillness while playing; a tap or
  // any control wakes them and restarts the count.
  useEffect(() => {
    if (paused || scrubbing || !awake) return;
    const timer = setTimeout(() => setAwake(false), IDLE_MS);
    return () => clearTimeout(timer);
  }, [paused, scrubbing, awake, activity]);

  // The spinner only for a wait you'd notice.
  useEffect(() => {
    if (!buffering || failed) {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), 250);
    return () => clearTimeout(timer);
  }, [buffering, failed]);

  const wake = useCallback(() => {
    setAwake(true);
    setActivity((n) => n + 1);
  }, []);

  const chromeVisible = paused || awake || scrubbing;

  /** Every control press counts as activity, so the controls stay while in use. */
  const act = (fn: () => void) => () => {
    wake();
    fn();
  };

  const handleScrubbing = (on: boolean) => {
    setScrubbing(on);
    if (!on) wake();
    onScrubbingChange?.(on);
  };

  const readout = position && position.total > 0 ? `${position.index + 1} of ${position.total}` : undefined;
  const scrubber =
    duration !== null && duration > 0 ? (
      canScrub ? (
        <ClipScrubber player={player} duration={duration} onScrubbingChange={handleScrubbing} />
      ) : (
        <ClipProgress player={player} duration={duration} />
      )
    ) : null;
  // In full screen the controls keep clear of the notch and the home indicator.
  const edge = fullscreen.active
    ? { top: insets.top, left: insets.left, right: insets.right, bottom: insets.bottom }
    : { top: 0, left: 0, right: 0, bottom: 0 };

  return (
    <View
      className="flex-1 overflow-hidden bg-black"
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <VideoView
        player={player}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        // No Live Text button on a paused frame: a tap on the footage is ours.
        allowsVideoFrameAnalysis={false}
      />

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {children}
      </View>

      {failed && (
        <View pointerEvents="none" accessibilityRole="alert" className="absolute inset-0 items-center justify-center bg-black/80 p-6">
          <Text variant="subheadline" className="max-w-sm text-center text-white">
            Can&apos;t load this clip. Check your connection and try again.
          </Text>
        </View>
      )}

      {showSpinner && (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ActivityIndicator size="large" color="rgba(255,255,255,0.8)" />
        </View>
      )}

      {/* A finger shows or hides the controls; it never pauses by accident. */}
      <Pressable
        accessible={false}
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (chromeVisible && !paused) setAwake(false);
          else wake();
        }}
      />

      {chromeVisible && width > 0 && (
        <Animated.View entering={fadeIn} exiting={fadeOut} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {idleLabel && !transport.isQueueActive && (
            <View pointerEvents="box-none" className="absolute inset-0 items-center justify-center">
              <Tappable
                accessibilityRole="button"
                onPress={act(onTogglePlay)}
                className="h-11 flex-row items-center gap-2 overflow-hidden rounded-full px-5"
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.18)" }}
              >
                <PlayerMaterial />
                <Icon name="play" size={15} color="white" />
                <Text variant="subheadline" className="font-semibold text-white">
                  {idleLabel}
                </Text>
              </Tappable>
            </View>
          )}
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: edge.left + (compact ? 10 : 12),
              right: edge.right + (compact ? 10 : 12),
              bottom: edge.bottom + (compact ? 10 : 12),
              alignItems: "center",
            }}
          >
            <View
              className="w-full max-w-3xl overflow-hidden rounded-[12px] pb-0.5 pl-3 pr-1.5 pt-1.5"
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.14)" }}
            >
              <PlayerMaterial />
              {scrubber ? <View className="pr-1.5">{scrubber}</View> : null}
              <ControlRow>
                <View className="-ml-2.5">
                  <ControlButton label="Previous clip" icon="previous" onPress={act(transport.onPrev)} disabled={!transport.canPrev} />
                </View>
                {!compact && (
                  <ControlButton label="Replay clip" icon="replay" onPress={act(transport.onReplay)} disabled={!transport.isQueueActive} />
                )}
                <PlayPauseButton paused={paused} onPress={act(onTogglePlay)} size="lg" />
                <ControlButton label="Next clip" icon="next" onPress={act(transport.onNext)} disabled={!transport.canNext} />
                {!compact && (
                  <ControlButton label="Stop" icon="stop" iconSize={16} onPress={act(transport.onStop)} disabled={!transport.isQueueActive} />
                )}
                {readout && !largeText && (
                  <Text variant="footnote" nums numberOfLines={1} maxFontSizeMultiplier={1.3} className="ml-1.5 shrink" style={{ color: "rgba(255,255,255,0.7)" }}>
                    {readout}
                  </Text>
                )}
                <View className="ml-auto flex-row items-center">
                  <SpeedMenu speed={speed} onSpeedChange={(s) => { wake(); onSpeedChange(s); }} />
                  <FullscreenButton active={fullscreen.active} onToggle={act(fullscreen.toggle)} />
                </View>
              </ControlRow>
            </View>
          </View>

          {fullscreen.active && (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                paddingTop: edge.top + 10,
                paddingBottom: 36,
                paddingLeft: edge.left + 16,
                paddingRight: edge.right + 16,
              }}
            >
              <TopShade />
              <View pointerEvents="box-none" className="flex-row items-center gap-3">
                {/* An explicit way out: rotating back isn't one. */}
                <Tappable
                  accessibilityRole="button"
                  onPress={fullscreen.exit}
                  className="h-9 flex-row items-center gap-1.5 overflow-hidden rounded-full px-3.5"
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.18)" }}
                >
                  <PlayerMaterial />
                  <Icon name="close" size={14} weight="semibold" color="white" />
                  <Text variant="subheadline" className="font-semibold text-white">
                    Done
                  </Text>
                </Tappable>
                {title && (
                  <Text variant="subheadline" numberOfLines={1} className="shrink font-medium text-white">
                    {title}
                  </Text>
                )}
                {readout && (
                  <Text variant="footnote" nums className="shrink-0" style={{ color: "rgba(255,255,255,0.7)" }}>
                    {readout}
                  </Text>
                )}
              </View>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

/** Black falling from the top edge, under the full-screen bar. */
function TopShade() {
  return <Shade from={0.7} to={0} />;
}

function Shade({ from, to }: { from: number; to: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000" stopOpacity={from} />
          <Stop offset="1" stopColor="#000" stopOpacity={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
