/**
 * Settings' appearance: Light, Dark or System as three preview tiles (as
 * Claude's and iOS's own settings draw them), each painted in the theme the
 * user picked for that mode, and the theme pickers for the Theme page
 * (swatches for the light and the dark slot). A pick applies at once and
 * follows the account to the other apps through ThemeSync; picking a theme
 * from the other mode also switches the mode (setColorTheme handles that,
 * and the analytics).
 */
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Polygon, Rect } from "react-native-svg";
import { DEFAULT_THEME, getTheme, type ColorTheme } from "@scoutable/shared/lib/themes";
import type { ThemeModeSetting } from "@scoutable/shared/lib/theme-sync";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";
import { selectionHaptic } from "@/lib/haptics";
import { useAppTheme, useThemeColors } from "@/lib/theme-context";

const COLUMNS = 3;
const TILE_W = 124;
const TILE_H = 80;

type Swatch = ColorTheme["swatch"];

/** A window in miniature: a card with two lines of text and the theme's accent dot. */
function Miniature({ swatch, dark }: { swatch: Swatch; dark: boolean }) {
  const line = dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)";
  return (
    <>
      <Rect x={0} y={0} width={TILE_W} height={TILE_H} fill={swatch.bg} />
      <Rect x={10} y={10} width={104} height={60} rx={8} fill={swatch.surface} />
      <Rect x={20} y={22} width={46} height={4} rx={2} fill={line} />
      <Rect x={20} y={31} width={30} height={4} rx={2} fill={line} />
      <Circle cx={98} cy={56} r={7} fill={swatch.primary} />
    </>
  );
}

function AppearanceTile({
  label,
  light,
  dark,
  value,
  selected,
  onSelect,
}: {
  label: string;
  light: Swatch;
  dark: Swatch;
  value: ThemeModeSetting;
  selected: boolean;
  onSelect: (v: ThemeModeSetting) => void;
}) {
  const colors = useThemeColors();
  const clipId = `split${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <Tappable
      scaleTo={0.97}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => {
        if (!selected) selectionHaptic();
        onSelect(value);
      }}
      className="flex-1 items-center gap-2"
    >
      <View style={styles.tileBox}>
        <View style={[styles.tile, { borderColor: colors.separator }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${TILE_W} ${TILE_H}`} preserveAspectRatio="none">
            {value === "dark" ? <Miniature swatch={dark} dark /> : <Miniature swatch={light} dark={false} />}
            {value === "system" ? (
              <>
                <Defs>
                  <ClipPath id={clipId}>
                    <Polygon points={`${TILE_W},0 ${TILE_W},${TILE_H} 0,${TILE_H}`} />
                  </ClipPath>
                </Defs>
                <G clipPath={`url(#${clipId})`}>
                  <Miniature swatch={dark} dark />
                </G>
              </>
            ) : null}
          </Svg>
        </View>
        {/* The ring sits outside the tile so choosing doesn't shift the row. */}
        {selected ? <View pointerEvents="none" style={[styles.ring, { borderColor: colors.primary }]} /> : null}
      </View>
      <Text variant="subheadline" numberOfLines={1} className={selected ? "font-semibold text-primary" : "text-muted-foreground"}>
        {label}
      </Text>
    </Tappable>
  );
}

/** Light, Dark or System, as three tiles in the theme picked for each mode. */
export function AppearanceTiles() {
  const { modeSetting, setModeSetting, slots } = useAppTheme();
  const light = (getTheme(slots.light) ?? getTheme(DEFAULT_THEME.light))!.swatch;
  const dark = (getTheme(slots.dark) ?? getTheme(DEFAULT_THEME.dark))!.swatch;
  const tiles: { value: ThemeModeSetting; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" className="flex-row gap-3 px-4 pb-3 pt-4">
      {tiles.map((t) => (
        <AppearanceTile
          key={t.value}
          label={t.label}
          value={t.value}
          light={light}
          dark={dark}
          selected={modeSetting === t.value}
          onSelect={setModeSetting}
        />
      ))}
    </View>
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

export function ThemeGrid({ heading, themes, chosen }: { heading: string; themes: ColorTheme[]; chosen: string }) {
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

const styles = StyleSheet.create({
  tileBox: { alignSelf: "stretch" },
  tile: { aspectRatio: TILE_W / TILE_H, borderRadius: 12, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  ring: { position: "absolute", left: -3, right: -3, top: -3, bottom: -3, borderRadius: 15, borderWidth: 2 },
});
