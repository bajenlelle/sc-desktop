/**
 * The playing clip's timeline (the web's clip-scrubber.tsx, built like
 * iOS's own): pressing near the thumb keeps the grab offset, pressing the
 * track jumps there, the thumb follows the finger 1:1, resists past the
 * ends and springs back on release. Scrubbing pauses the clip and plays it
 * again on release if it was playing: finding the frame is the task. At most
 * one seek per frame reaches the player.
 *
 * The pan runs on the JS thread so it can use the tested shared maths
 * (clamp, rubberband); the thumb itself moves on the UI thread, gliding
 * between the player's time reports instead of jumping ten times a second.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useEventListener } from "expo";
import type { VideoPlayer } from "expo-video";
import { clamp, rubberband } from "@scoutable/shared/lib/motion-math";
import { formatClipTime } from "@scoutable/shared/lib/clip-timing";
import { Text } from "@/components/ui/Text";
import { springs } from "@/lib/motion";

/** How close to the thumb a press counts as grabbing it (touch). */
const THUMB_HIT = 24;
/** The player's time-report interval, which the thumb glides across. */
const REPORT_SECONDS = 0.1;

/**
 * Follows playback for a timeline: the elapsed time for the labels, and
 * where playback is (0–1) for the UI thread. Each time report glides the
 * line to where playback will be at the next one (no glide while paused:
 * it's exactly there). Nothing follows while `held` is set: a finger is
 * on the scrubber.
 */
function usePlaybackFollow(player: VideoPlayer, duration: number, held: RefObject<unknown>) {
  const [elapsed, setElapsed] = useState(() => clamp(player.currentTime, 0, duration));
  const progress = useSharedValue(clamp(player.currentTime / duration, 0, 1));
  const follow = useCallback(
    (time: number) => {
      if (held.current) return;
      setElapsed(clamp(time, 0, duration));
      const lead = player.playing ? REPORT_SECONDS * player.playbackRate : 0;
      const target = clamp((time + lead) / duration, 0, 1);
      progress.value = lead > 0 ? withTiming(target, { duration: REPORT_SECONDS * 1000, easing: Easing.linear }) : target;
    },
    [duration, player, progress, held],
  );
  useEventListener(player, "timeUpdate", ({ currentTime }) => follow(currentTime));
  useEventListener(player, "playingChange", () => follow(player.currentTime));
  useEffect(() => follow(player.currentTime), [follow, player]);
  return { elapsed, setElapsed, progress, follow };
}

export function ClipScrubber({
  player,
  duration: total,
  onScrubbingChange,
}: {
  player: VideoPlayer;
  /** The clip's length: each clip is its own file, so the track spans it. */
  duration: number;
  onScrubbingChange?: (scrubbing: boolean) => void;
}) {
  const duration = Math.max(0.001, total);
  const width = useSharedValue(0);
  /** How far the thumb is dragged past an end, after resistance (px). */
  const overshoot = useSharedValue(0);
  const pressed = useSharedValue(0);
  const scrubRef = useRef<{ grabOffset: number; wasPlaying: boolean; time: number } | null>(null);
  const seekRef = useRef<{ time: number; frame: number | null }>({ time: 0, frame: null });
  const { elapsed, setElapsed, progress, follow } = usePlaybackFollow(player, duration, scrubRef);

  /** At most one seek per frame: the latest position wins. */
  const scheduleSeek = useCallback(
    (time: number) => {
      seekRef.current.time = time;
      if (seekRef.current.frame !== null) return;
      seekRef.current.frame = requestAnimationFrame(() => {
        seekRef.current.frame = null;
        player.currentTime = seekRef.current.time;
      });
    },
    [player],
  );
  useEffect(
    () => () => {
      if (seekRef.current.frame !== null) cancelAnimationFrame(seekRef.current.frame);
    },
    [],
  );

  const moveTo = (x: number) => {
    const s = scrubRef.current;
    if (!s) return;
    const w = width.value;
    const raw = x - s.grabOffset;
    // Past either end the thumb resists instead of stopping dead.
    const over = raw < 0 ? raw : raw > w ? raw - w : 0;
    overshoot.value = rubberband(over, w);
    const time = clamp(raw / Math.max(1, w), 0, 1) * duration;
    progress.value = time / duration;
    s.time = time;
    setElapsed(time);
    scheduleSeek(time);
  };

  const begin = (x: number) => {
    const thumbAt = progress.value * width.value;
    scrubRef.current = {
      grabOffset: Math.abs(x - thumbAt) <= THUMB_HIT ? x - thumbAt : 0,
      wasPlaying: player.playing,
      time: player.currentTime,
    };
    if (player.playing) player.pause();
    try {
      player.scrubbingModeOptions = { scrubbingModeEnabled: true };
    } catch {
      // Older native module: plain seeks still work.
    }
    pressed.value = withSpring(1, springs.snappy);
    onScrubbingChange?.(true);
    moveTo(x);
  };

  const end = () => {
    const s = scrubRef.current;
    if (!s) return;
    scrubRef.current = null;
    if (seekRef.current.frame !== null) {
      cancelAnimationFrame(seekRef.current.frame);
      seekRef.current.frame = null;
    }
    try {
      player.scrubbingModeOptions = { scrubbingModeEnabled: false };
    } catch {
      // As above.
    }
    player.currentTime = s.time;
    overshoot.value = withSpring(0, springs.settle);
    pressed.value = withSpring(0, springs.snappy);
    onScrubbingChange?.(false);
    if (s.wasPlaying) player.play();
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => begin(e.x))
    .onUpdate((e) => moveTo(e.x))
    .onFinalize(() => end());

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * width.value + overshoot.value - 8 },
      { scale: 1 + pressed.value * 0.4 },
    ],
  }));

  const nudge = (delta: number) => {
    const t = clamp(player.currentTime + delta, 0, Math.max(0, duration - 0.05));
    player.currentTime = t;
    follow(t);
  };

  return (
    <View className="flex-row items-center gap-2">
      <TimeLabel align="right">{formatClipTime(elapsed)}</TimeLabel>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Clip position"
          accessibilityValue={{ text: `${formatClipTime(elapsed)} of ${formatClipTime(duration)}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}
          onLayout={(e: LayoutChangeEvent) => {
            width.value = e.nativeEvent.layout.width;
          }}
          className="h-9 flex-1 justify-center"
        >
          <View className="h-1.5 overflow-hidden rounded-full bg-white/25">
            <Animated.View
              style={[{ height: "100%", width: "100%", borderRadius: 3, backgroundColor: "rgba(255,255,255,0.9)", transformOrigin: "left" }, fillStyle]}
            />
          </View>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                left: 0,
                top: 10,
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: "#ffffff",
                shadowColor: "#000",
                shadowOpacity: 0.5,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
      <TimeLabel align="left">{formatClipTime(duration)}</TimeLabel>
    </View>
  );
}

/**
 * The playing clip's timeline for a viewer who may not drag it (a player: a
 * clip counts as watched near its end, so dragging there would skip it).
 * The scrubber's times around a thinner line with nothing to grab; VoiceOver
 * reads it as a progress bar, and a tap goes through to the footage.
 */
export function ClipProgress({ player, duration: total }: { player: VideoPlayer; duration: number }) {
  const duration = Math.max(0.001, total);
  const never = useRef(null);
  const { elapsed, progress } = usePlaybackFollow(player, duration, never);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return (
    <View pointerEvents="none" className="flex-row items-center gap-2">
      <TimeLabel align="right">{formatClipTime(elapsed)}</TimeLabel>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Clip position"
        accessibilityValue={{ text: `${formatClipTime(elapsed)} of ${formatClipTime(duration)}` }}
        className="h-6 flex-1 justify-center"
      >
        <View className="h-1 overflow-hidden rounded-full bg-white/25">
          <Animated.View
            style={[{ height: "100%", width: "100%", borderRadius: 2, backgroundColor: "rgba(255,255,255,0.9)", transformOrigin: "left" }, fillStyle]}
          />
        </View>
      </View>
      <TimeLabel align="left">{formatClipTime(duration)}</TimeLabel>
    </View>
  );
}

function TimeLabel({ children, align }: { children: string; align: "left" | "right" }) {
  return (
    <Text
      variant="caption"
      nums
      maxFontSizeMultiplier={1.2}
      numberOfLines={1}
      className="w-11 font-normal"
      style={{ color: "rgba(255,255,255,0.8)", textAlign: align, fontSize: 12, lineHeight: 16 }}
    >
      {children}
    </Text>
  );
}
