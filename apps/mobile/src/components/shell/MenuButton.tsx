import { useMemo } from "react";
import { Keyboard } from "react-native";
import { useNavigation } from "expo-router";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { GlassButton } from "@/components/shell/GlassButton";
import { Icon } from "@/components/ui/Icon";
import { usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";

/**
 * Opens the sidebar from a root screen's bar. A primary dot marks unwatched
 * playlists (the tab bar's red count before the sidebar replaced it; the
 * count itself sits beside the playlists row in the sidebar).
 */
export function MenuButton() {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const { feedItems } = usePlaylists();
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  return (
    <GlassButton
      // The drawer navigator above the tab stacks handles this action. The
      // drawer only dismisses the keyboard when dragged open, so the button
      // does it (else the keyboard covers the sidebar after a search).
      onPress={() => {
        Keyboard.dismiss();
        navigation.dispatch({ type: "OPEN_DRAWER" });
      }}
      accessibilityLabel={newCount > 0 ? `Open menu, ${newCount} new` : "Open menu"}
      badge={newCount > 0}
    >
      <Icon name="menu" size={20} color={colors.foreground} />
    </GlassButton>
  );
}
