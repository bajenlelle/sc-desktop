import type { ComponentProps } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tabs } from "expo-router";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Tappable } from "@/components/ui/Tappable";
import { Material } from "@/components/shell/Material";
import { TAB_BAR_H } from "@/lib/layout";
import { pressScale } from "@/lib/motion";
import { useThemeColors } from "@/lib/theme-context";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export interface TabItem {
  /** The route name in the (tabs) group. */
  name: string;
  title: string;
  icon: IconName;
  /** A count in a red badge on the icon (new playlists); nothing at 0. */
  badge?: number;
}

/**
 * The app's own tab bar, the same on iOS and Android, as the web's phone tab
 * bar draws it: 49 pt of material over the home indicator with a hairline on
 * top, lucide icons at 24 pt over 10 pt labels, the current tab in the
 * primary colour. It floats over the content (screens pad for it through
 * ShellContext) so lists scroll under the material. Which tabs show is the
 * layout's decision (`items`); the badge is the count of new playlists.
 */
export function TabBar({ state, navigation, items }: TabBarProps & { items: TabItem[] }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const focusedName = state.routes[state.index]?.name;
  const shown = items.filter((item) => state.routes.some((r) => r.name === item.name));

  return (
    <Material
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: TAB_BAR_H + insets.bottom, paddingBottom: insets.bottom }}
    >
      <View style={[styles.hairline, { backgroundColor: colors.separator }]} />
      <View accessibilityRole="tablist" style={styles.row}>
        {shown.map((item, i) => {
          const route = state.routes.find((r) => r.name === item.name)!;
          const focused = route.name === focusedName;
          const tint = focused ? colors.primary : colors.mutedForeground;
          const badge = item.badge && item.badge > 0 ? (item.badge > 99 ? "99+" : String(item.badge)) : null;
          return (
            <Tappable
              key={route.key}
              scaleTo={pressScale.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={`${item.title}${badge ? `, ${badge} new` : ""}, tab ${i + 1} of ${shown.length}`}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
              style={styles.item}
            >
              <View>
                <Icon name={item.icon} size={24} color={tint} />
                {badge && (
                  <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
                    <RNText maxFontSizeMultiplier={1.2} style={styles.badgeText}>
                      {badge}
                    </RNText>
                  </View>
                )}
              </View>
              <RNText maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.label, { color: tint }]}>
                {item.title}
              </RNText>
            </Tappable>
          );
        })}
      </View>
    </Material>
  );
}

const styles = StyleSheet.create({
  hairline: { position: "absolute", left: 0, right: 0, top: 0, height: StyleSheet.hairlineWidth },
  row: { flex: 1, flexDirection: "row", paddingHorizontal: 8 },
  item: { flex: 1, alignItems: "center", paddingTop: 7, gap: 2 },
  label: { fontSize: 10, lineHeight: 12, fontWeight: "500", letterSpacing: 0.1 },
  badge: {
    position: "absolute",
    top: -5,
    left: 15,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#ffffff", fontSize: 12, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
