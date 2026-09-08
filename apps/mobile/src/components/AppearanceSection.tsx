/**
 * Profile-tab Appearance card: a System/Light/Dark mode row plus swatch grids
 * for the dark and light theme slots — the mobile counterpart of the desktop
 * Settings Appearance card (theme-picker.tsx). Selection applies instantly
 * and syncs to the user's other devices via ThemeSync; picking a theme from
 * the other group also switches the mode (setColorTheme handles that plus
 * analytics).
 */
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLOR_THEMES, type ColorTheme } from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import { useAppTheme } from "@/lib/theme-context";

const MODE_OPTIONS: Array<{ id: ThemeModeSetting; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function ThemeSwatch({
  theme,
  active,
  checkColor,
  onPress,
}: {
  theme: ColorTheme;
  active: boolean;
  checkColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={theme.label}
      onPress={onPress}
      className={`w-[30%] overflow-hidden rounded-lg border ${
        active ? "border-primary" : "border-border"
      }`}
      style={active ? { borderWidth: 2 } : undefined}
    >
      <View style={{ backgroundColor: theme.swatch.bg, padding: 6, height: 44 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.swatch.surface,
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 4,
            justifyContent: "space-between",
          }}
        >
          <View
            style={{ height: 4, width: 22, borderRadius: 999, backgroundColor: theme.swatch.primary }}
          />
          <View
            style={{ height: 4, width: 14, borderRadius: 999, backgroundColor: theme.swatch.accent }}
          />
        </View>
      </View>
      <View className="flex-row items-center justify-between border-t border-border px-1.5 py-1">
        <Text numberOfLines={1} className="flex-1 text-[11px] text-foreground">
          {theme.label}
        </Text>
        {active && <Ionicons name="checkmark" size={12} color={checkColor} />}
      </View>
    </Pressable>
  );
}

export function AppearanceSection() {
  const { activeThemeId, modeSetting, colors, setColorTheme, setModeSetting } = useAppTheme();
  const darkThemes = COLOR_THEMES.filter((t) => t.mode === "dark");
  const lightThemes = COLOR_THEMES.filter((t) => t.mode === "light");

  return (
    <View className="gap-3 rounded-xl border border-border p-4">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Appearance
      </Text>

      <View className="flex-row gap-2" accessibilityRole="radiogroup">
        {MODE_OPTIONS.map((m) => {
          const active = modeSetting === m.id;
          return (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setModeSetting(m.id)}
              className={`min-h-[32px] justify-center rounded-full px-3.5 ${
                active ? "bg-primary" : "bg-muted"
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  active ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-xs font-medium text-muted-foreground">Dark theme</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {darkThemes.map((t) => (
          <ThemeSwatch
            key={t.id}
            theme={t}
            active={t.id === activeThemeId}
            checkColor={colors.primary}
            onPress={() => setColorTheme(t.id)}
          />
        ))}
      </View>

      <Text className="text-xs font-medium text-muted-foreground">Light theme</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {lightThemes.map((t) => (
          <ThemeSwatch
            key={t.id}
            theme={t}
            active={t.id === activeThemeId}
            checkColor={colors.primary}
            onPress={() => setColorTheme(t.id)}
          />
        ))}
      </View>
    </View>
  );
}
