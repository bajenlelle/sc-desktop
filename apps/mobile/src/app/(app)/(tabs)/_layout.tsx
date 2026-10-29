import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { feedCounts } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { syncAppBadge } from "@/lib/notifications";
import { offerTeamStepOnce, useMyTeam } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { needsTeamStep, teamRoleIn } from "@scoutable/shared/lib/league-teams";
import { useThemeColors } from "@/lib/theme-context";

/**
 * The system tab bar (UITabBar on iOS, Liquid Glass from iOS 26; Material's
 * navigation bar on Android), as the web's phone layout imitates it:
 * Playlists and Profile for everyone, My highlights (the personal space) for
 * player-only users. Each tab is its own native stack with a large title.
 * The watch screen (playlists/[id]), /team and the sheets live OUTSIDE this
 * group, so they cover the tab bar.
 *
 * Hiding a native tab remounts the whole navigator, so whether My highlights
 * shows is decided once, when the first profile has settled, and then kept:
 * a later reload (a staff club switch reloads the profile) never flips it.
 */
export default function TabsLayout() {
  const { isPlayerOnly, activeOrgRole, activeOrg, profile, profileLoading } = useAuth();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const { feedItems, loading } = usePlaylists();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const colors = useThemeColors();

  const [playerOnlyLatch, setPlayerOnlyLatch] = useState<boolean | null>(null);
  useEffect(() => {
    if (playerOnlyLatch === null && !profileLoading && profile) setPlayerOnlyLatch(isPlayerOnly);
  }, [playerOnlyLatch, profileLoading, profile, isPlayerOnly]);

  // Fully-unwatched playlists: same semantics as the feed's "New" filter
  // (both derive from the store's shared feedItems).
  const newCount = useMemo(() => feedCounts(feedItems).new, [feedItems]);
  const playlistsTitle = isCoachOrAdmin ? "Shared playlists" : "My playlists";

  // App-icon badge mirrors the tab badge. The !loading guard stops the
  // initial fetch from flashing the icon count to 0.
  useEffect(() => {
    if (!loading) syncAppBadge(newCount);
  }, [newCount, loading]);

  // "Which team do you play for?" once per club space: shown over the tabs
  // until answered (skip counts), at most once per launch.
  const declaredRole = profile?.declaredRole;
  useEffect(() => {
    if (!activeOrg || activeOrg.isNtOrg || !teamsLoaded) return;
    if (!needsTeamStep(choices, activeOrg.orgId) || !offerTeamStepOnce(activeOrg.orgId)) return;
    trackEvent("team_step_shown", { role: teamRoleIn(activeOrg, declaredRole) });
    router.push({ pathname: "/team", params: { mode: "step", orgId: activeOrg.orgId } });
  }, [activeOrg, teamsLoaded, choices, declaredRole]);

  if (playerOnlyLatch === null) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <NativeTabs
      tintColor={colors.primary}
      iconColor={Platform.OS === "android" ? { default: colors.mutedForeground, selected: colors.primary } : undefined}
      labelStyle={Platform.OS === "android" ? { color: colors.mutedForeground } : undefined}
      backgroundColor={Platform.OS === "android" ? colors.background : undefined}
      indicatorColor={Platform.OS === "android" ? colors.fill3 : undefined}
      badgeBackgroundColor={colors.destructive}
    >
      <NativeTabs.Trigger
        name="playlists"
        accessibilityLabel={newCount > 0 ? `${playlistsTitle}, ${newCount} new` : playlistsTitle}
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: "play.rectangle.on.rectangle", selected: "play.rectangle.on.rectangle.fill" }}
          md="video_library"
        />
        <NativeTabs.Trigger.Label>{playlistsTitle}</NativeTabs.Trigger.Label>
        {newCount > 0 && <NativeTabs.Trigger.Badge>{String(newCount)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="highlights" hidden={!playerOnlyLatch}>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>My highlights</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
          md="account_circle"
        />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
