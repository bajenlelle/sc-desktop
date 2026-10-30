import { Alert, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { getTheme } from "@scoutable/shared/lib/themes";
import { groupChoicesForProfile, teamSpaces, teamSummaryLabel } from "@scoutable/shared/lib/league-teams";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import { partitionDevicesByActivity } from "@scoutable/shared/lib/device-boot";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { useMyDevices } from "@/lib/use-my-devices";
import { signOutAndCleanup } from "@/lib/notifications";
import { usePlaylists } from "@/lib/playlists-store";
import { useAppTheme } from "@/lib/theme-context";
import { AppearanceTiles } from "@/components/AppearanceSection";
import { CloseButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { AccountCard } from "@/components/settings/AccountCard";
import { LicenseNotice } from "@/components/LicenseNotice";
import { GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
import { Text } from "@/components/ui/Text";

/**
 * Settings, the sheet's first page, as Claude's and iOS's own: who you are
 * at the top (the card opens Profile), then short groups whose rows show
 * their current value and open a page of their own (Team, Devices, Theme,
 * Send feedback), the appearance tiles in place, and Sign out last, apart
 * and asking first. Left out on purpose (App Store 3.1.3(c), and no new
 * features): the plan and usage, managing the club, notifications, and
 * anything that links out to the web.
 */
export default function SettingsScreen() {
  const { user, myOrgs, activeOrg, isPlayerOnly } = useAuth();
  const { choices, loaded } = useMyTeam();
  const { clubTeams } = usePlaylists();
  const { devices } = useMyDevices();
  const { activeThemeId } = useAppTheme();

  const spaces = sortOrgsClubFirst(teamSpaces(myOrgs));
  const teamValue = teamSummaryLabel(loaded && spaces.length > 0 ? groupChoicesForProfile(spaces, choices) : []);
  const hasClubs = isPlayerOnly ? clubTeams.length > 0 : !!activeOrg && !activeOrg.isPersonal;
  // Both rows hold their place while their data loads, so nothing below
  // them jumps when it arrives; each goes only once it's known to be empty.
  const showTeam = !loaded || teamValue != null || hasClubs;
  const showDevices = devices === null || devices.length > 0;
  const activeDevices = devices && devices.length > 0 ? partitionDevicesByActivity(devices).active.length : null;

  function confirmSignOut() {
    Alert.alert("Sign out?", user?.email ? `You're signed in as ${user.email}.` : undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOutAndCleanup() },
    ]);
  }

  return (
    <Screen title="Settings" sheet leading={<CloseButton />} grouped contentClassName="gap-6 px-4 pt-2">
      <View className="gap-3">
        <AccountCard />
        <View className="-mx-4">
          <LicenseNotice />
        </View>
      </View>

      {showTeam || showDevices ? (
        <View>
          <GroupHeader title="Account" />
          <GroupedList large inset={50}>
            {showTeam ? (
              <GroupRow
                large
                icon="team"
                label="Team"
                trailing={teamValue ?? undefined}
                chevron
                onPress={() => router.push("/profile/team")}
              />
            ) : null}
            {showDevices ? (
              <GroupRow
                large
                icon="devices"
                label="Devices"
                trailing={activeDevices != null ? String(activeDevices) : undefined}
                accessibilityLabel={activeDevices != null ? `Devices, ${activeDevices} active` : "Devices"}
                chevron
                onPress={() => router.push("/profile/devices")}
              />
            ) : null}
          </GroupedList>
        </View>
      ) : null}

      <View>
        <GroupHeader title="Appearance" />
        <GroupedList large>
          <AppearanceTiles />
          <GroupRow
            large
            icon="palette"
            label="Theme"
            trailing={getTheme(activeThemeId)?.label ?? ""}
            chevron
            onPress={() => router.push("/profile/theme")}
          />
        </GroupedList>
      </View>

      <View>
        <GroupHeader title="Help" />
        <GroupedList large inset={50}>
          <GroupRow
            large
            icon="feedback"
            label="Send feedback"
            chevron
            onPress={() => router.push({ pathname: "/profile/feedback", params: { from: "/profile" } })}
          />
        </GroupedList>
      </View>

      <GroupedList large>
        <GroupRow
          large
          icon="signOut"
          label="Sign out"
          destructive
          accessibilityLabel={`Sign out of ${user?.email ?? "Scoutable"}`}
          onPress={confirmSignOut}
        />
      </GroupedList>

      <Text variant="footnote" nums className="text-center text-muted-foreground">
        Scoutable {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}
