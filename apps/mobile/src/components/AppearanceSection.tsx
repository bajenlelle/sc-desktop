/**
 * Profile › Account's appearance rows: Light, Dark or System as a small
 * segmented control, and the theme as a disclosure row that opens the theme
 * sheet (swatches for the light and the dark slot). A pick applies at once
 * and follows the account to the other apps through ThemeSync; picking a
 * theme from the other mode also switches the mode (setColorTheme handles
 * that, and the analytics).
 */
import { useState } from "react";
import { View } from "react-native";
import { COLOR_THEMES, getTheme, type ColorTheme } from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import { GroupRow } from "@/components/ui/Group";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { TextButton } from "@/components/ui/Row";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

const COLUMNS = 3;

export function AppearanceRow() {
  const { modeSetting, setModeSetting } = useAppTheme();
  return (
    <GroupRow
      label="Appearance"
      trailing={
        <SegmentedControl<ThemeModeSetting>
          size="sm"
          accessibilityLabel="Appearance"
          value={modeSetting}
          onValueChange={setModeSetting}
          segments={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      }
    />
  );
}

export function ThemeRow() {
  const { activeThemeId } = useAppTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <GroupRow label="Theme" trailing={getTheme(activeThemeId)?.label ?? ""} chevron onPress={() => setOpen(true)} />
      <ThemeSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ThemeSwatch({ theme, active, onPress }: { theme: ColorTheme; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Tappable
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={theme.label}
      onPress={onPress}
      className="flex-1 gap-1.5"
    >
      <View>
        <View
          className="overflow-hidden rounded-window"
          style={{ height: 56, backgroundColor: theme.swatch.bg, borderWidth: 0.5, borderColor: colors.separator }}
        >
          <View style={{ position: "absolute", left: 10, top: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.swatch.primary }} />
          <View style={{ position: "absolute", left: 10, right: 10, bottom: 10, height: 14, borderRadius: 4, backgroundColor: theme.swatch.surface }} />
        </View>
        {/* The ring sits outside the tile so choosing doesn't shift the grid. */}
        {active && (
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: -3, right: -3, top: -3, bottom: -3, borderRadius: 13, borderWidth: 2, borderColor: colors.primary }}
          />
        )}
      </View>
      <Text variant="footnote" numberOfLines={1} className={active ? "text-center font-semibold" : "text-center text-muted-foreground"}>
        {theme.label}
      </Text>
    </Tappable>
  );
}

function ThemeGrid({ heading, themes, chosen }: { heading: string; themes: ColorTheme[]; chosen: string }) {
  const { setColorTheme } = useAppTheme();
  const rows: (ColorTheme | null)[][] = [];
  for (let i = 0; i < themes.length; i += COLUMNS) {
    const row: (ColorTheme | null)[] = themes.slice(i, i + COLUMNS);
    while (row.length < COLUMNS) row.push(null);
    rows.push(row);
  }
  return (
    <View>
      <Text variant="subheadline" className="px-4 pb-2 pt-4 text-muted-foreground">
        {heading}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${heading} themes`} className="gap-3.5 px-4">
        {rows.map((row, i) => (
          <View key={i} className="flex-row gap-3">
            {row.map((t, j) =>
              t ? (
                <ThemeSwatch key={t.id} theme={t} active={t.id === chosen} onPress={() => setColorTheme(t.id)} />
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

/** One theme for light mode and one for dark, as swatches. */
function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { slots } = useAppTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Theme" trailing={<TextButton label="Done" size="body" onPress={onClose} />}>
      <ThemeGrid heading="Light" themes={COLOR_THEMES.filter((t) => t.mode === "light")} chosen={slots.light} />
      <ThemeGrid heading="Dark" themes={COLOR_THEMES.filter((t) => t.mode === "dark")} chosen={slots.dark} />
      <Text variant="footnote" className="px-4 pb-2 pt-5 text-muted-foreground">
        One theme for light mode and one for dark. Your picks follow you to the desktop app and the web.
      </Text>
    </Sheet>
  );
}
