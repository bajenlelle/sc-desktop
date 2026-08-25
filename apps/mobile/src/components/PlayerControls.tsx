/**
 * Playback controls under the video — port of web video-clip-controls.tsx:
 * prev · play/pause · next · replay · stop · speed. Text-only glyphs keep the
 * bundle icon-free; sizes hold the 44px touch floor.
 */
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SPEEDS } from "@/hooks/use-clip-queue";

function ControlButton({
  glyph,
  label,
  onPress,
  disabled,
  size = "md",
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      className={`items-center justify-center rounded-full ${
        size === "lg"
          ? "h-14 w-14 bg-primary dark:bg-primary-dark active:opacity-80"
          : "h-11 w-11 active:bg-muted dark:active:bg-muted-dark"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <Text
        className={
          size === "lg"
            ? "text-xl text-primary-foreground dark:text-primary-foreground-dark"
            : "text-lg text-foreground dark:text-foreground-dark"
        }
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

export function PlayerControls({
  isQueueActive,
  isPaused,
  canPrev,
  canNext,
  speed,
  onPlayPause,
  onPrev,
  onNext,
  onReplay,
  onStop,
  onSpeedChange,
}: {
  isQueueActive: boolean;
  isPaused: boolean;
  canPrev: boolean;
  canNext: boolean;
  speed: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onStop: () => void;
  onSpeedChange: (s: number) => void;
}) {
  const [speedOpen, setSpeedOpen] = useState(false);

  return (
    <View className="flex-row items-center justify-between px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Playback speed"
        onPress={() => setSpeedOpen(true)}
        className="min-h-[44px] min-w-[44px] items-center justify-center rounded-md active:bg-muted dark:active:bg-muted-dark"
      >
        <Text className="text-xs font-semibold text-muted-foreground dark:text-muted-foreground-dark">
          {speed}×
        </Text>
      </Pressable>

      <View className="flex-row items-center gap-2">
        <ControlButton glyph="⏮" label="Previous clip" onPress={onPrev} disabled={!canPrev} />
        <ControlButton
          glyph={!isQueueActive || isPaused ? "▶" : "⏸"}
          label={!isQueueActive || isPaused ? "Play" : "Pause"}
          onPress={onPlayPause}
          size="lg"
        />
        <ControlButton glyph="⏭" label="Next clip" onPress={onNext} disabled={!canNext} />
      </View>

      <View className="flex-row items-center">
        <ControlButton glyph="↻" label="Replay" onPress={onReplay} disabled={!isQueueActive} />
        <ControlButton glyph="■" label="Stop" onPress={onStop} disabled={!isQueueActive} />
      </View>

      <Modal
        visible={speedOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeedOpen(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setSpeedOpen(false)}>
          <Pressable
            className="rounded-t-2xl bg-card dark:bg-card-dark pb-8 pt-2"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mx-auto my-2 h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
            <Text className="px-5 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
              Playback speed
            </Text>
            {SPEEDS.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="menuitem"
                onPress={() => {
                  onSpeedChange(s);
                  setSpeedOpen(false);
                }}
                className="min-h-[48px] flex-row items-center justify-between px-5 active:bg-muted dark:active:bg-muted-dark"
              >
                <Text
                  className={`text-base ${
                    s === speed
                      ? "font-semibold text-primary dark:text-primary-dark"
                      : "text-foreground dark:text-foreground-dark"
                  }`}
                >
                  {s}×
                </Text>
                {s === speed ? <Text className="text-primary dark:text-primary-dark">✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
