import { useRef } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSolidMaterial } from "@/components/shell/Material";
import { Icon } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { interStyle } from "@/lib/fonts";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

export const SEARCH_CAPSULE_H = 52;

/**
 * Search as Claude's lists put it: a floating capsule at the foot of the
 * screen, within thumb reach, blurred over the content on iOS and solid on
 * Android. The screen lifts it above the keyboard while typing (Screen's
 * `bottom` slot). A clear button shows once there is text.
 */
export function SearchCapsule({
  value,
  onChangeText,
  placeholder = "Search",
  accessibilityLabel = "Search playlists",
  onFocusChange,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  /** Typing or not, so the screen can tuck the action pill away. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  const solid = useSolidMaterial();
  const input = useRef<TextInput>(null);
  return (
    <Tappable
      scaleTo={1}
      accessible={false}
      onPress={() => input.current?.focus()}
      style={[
        styles.capsule,
        { borderColor: colors.separator, backgroundColor: solid ? colors.popover : "transparent" },
        solid ? styles.raised : null,
      ]}
    >
      {solid ? null : (
        <>
          <BlurView intensity={50} tint={resolvedMode} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.materialPopover }]} />
        </>
      )}
      <View className="pl-4 pr-2">
        <Icon name="search" size={20} color={colors.mutedForeground} />
      </View>
      <TextInput
        ref={input}
        testID="search"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        style={[styles.input, { color: colors.foreground }, interStyle(400)]}
      />
      {value.length > 0 ? (
        <Tappable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={6}
          onPress={() => onChangeText("")}
          className="h-full items-center justify-center pl-2 pr-4"
        >
          <View className="h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/50">
            <Icon name="close" size={12} strokeWidth={2.5} color={colors.background} />
          </View>
        </Tappable>
      ) : (
        <View className="w-4" />
      )}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  capsule: {
    height: SEARCH_CAPSULE_H,
    borderRadius: SEARCH_CAPSULE_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  raised: { elevation: 6 },
  input: { flex: 1, fontSize: 17, letterSpacing: -0.2, paddingVertical: 0, height: SEARCH_CAPSULE_H },
});
