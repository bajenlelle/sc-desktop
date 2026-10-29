/**
 * Profile › Appearance (the web's Appearance group): Light, Dark or System
 * as a segmented control, then the themes as swatch cards in a Dark and a
 * Light row. A pick applies at once and follows the account to the other
 * apps through ThemeSync; picking a theme from the other row also switches
 * the mode (setColorTheme handles that, and the analytics).
 */
import { View } from "react-native";
import { COLOR_THEMES, type ColorTheme } from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import { GroupFooter, GroupHeader, GroupedList } from "@/components/ui/Group";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

const COLUMNS = 3;

function ThemeSwatch({ theme, active, onPress }: { theme: ColorTheme; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={theme.label}
      onPress={onPress}
      className="flex-1 overflow-hidden rounded-lg"
    >
      <View style={{ height: 48, padding: 8, backgroundColor: theme.swatch.bg }}>
        <View
          style={{
            flex: 1,
            justifyContent: "space-between",
            borderRadius: 2,
            paddingHorizontal: 6,
            paddingVertical: 4,
            backgroundColor: theme.swatch.surface,
          }}
        >
          <View style={{ height: 6, width: 32, borderRadius: 3, backgroundColor: theme.swatch.primary }} />
          <View style={{ height: 6, width: 20, borderRadius: 3, backgroundColor: theme.swatch.accent }} />
        </View>
      </View>
      <View className="flex-row items-center justify-between gap-1 border-t border-separator px-2 py-1.5">
        <Text variant="callout" numberOfLines={1} className="shrink">
          {theme.label}
        </Text>
        {active && <Icon name="check" size={13} weight="semibold" color={colors.primary} />}
      </View>
      {/* The ring sits over the card so choosing doesn't shift the grid. */}
      <View
        pointerEvents="none"
        className="absolute inset-0 rounded-lg"
        style={{ borderWidth: active ? 2 : 1, borderColor: active ? colors.primary : colors.separator }}
      />
    </Tappable>
  );
}

function ThemeRow({ heading, themes }: { heading: string; themes: ColorTheme[] }) {
  const { activeThemeId, setColorTheme } = useAppTheme();
  const rows: (ColorTheme | null)[][] = [];
  for (let i = 0; i < themes.length; i += COLUMNS) {
    const row: (ColorTheme | null)[] = themes.slice(i, i + COLUMNS);
    while (row.length < COLUMNS) row.push(null);
    rows.push(row);
  }
  return (
    <View className="gap-1.5">
      <Text variant="subheadline" className="font-semibold text-muted-foreground">
        {heading}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${heading} themes`} className="gap-3">
        {rows.map((row, i) => (
          <View key={i} className="flex-row gap-3">
            {row.map((t, j) =>
              t ? (
                <ThemeSwatch key={t.id} theme={t} active={t.id === activeThemeId} onPress={() => setColorTheme(t.id)} />
              ) : (
                <View key={`empty-${j}`} className="flex-1" />
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

export function AppearanceSection() {
  const { modeSetting, setModeSetting } = useAppTheme();
  return (
    <View>
      <GroupHeader title="Appearance" />
      <GroupedList>
        <View className="gap-3 px-4 py-2.5">
          <View>
            <Text>Appearance</Text>
            <Text variant="callout" className="text-muted-foreground">
              Light, dark, or follow the system
            </Text>
          </View>
          <SegmentedControl<ThemeModeSetting>
            fullWidth
            size="md"
            accessibilityLabel="Appearance"
            value={modeSetting}
            onValueChange={setModeSetting}
            segments={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </View>
        <View className="gap-3 px-4 py-3">
          <Text>Theme</Text>
          <ThemeRow heading="Dark" themes={COLOR_THEMES.filter((t) => t.mode === "dark")} />
          <ThemeRow heading="Light" themes={COLOR_THEMES.filter((t) => t.mode === "light")} />
        </View>
      </GroupedList>
      <GroupFooter>Picking a theme applies it right away. Your choice follows you to the desktop and mobile apps.</GroupFooter>
    </View>
  );
}
