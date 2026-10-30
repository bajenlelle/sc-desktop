import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { signOutAndCleanup } from "@/lib/notifications";
import { usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";
import { AppearanceRow, ThemeRow } from "@/components/AppearanceSection";
import { Screen } from "@/components/shell/Screen";
import { Avatar } from "@/components/Avatar";
import { DevicesSection } from "@/components/DevicesSection";
import { LicenseNotice } from "@/components/LicenseNotice";
import { TeamSection } from "@/components/TeamSection";
import { GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
import { PopUpButton } from "@/components/ui/PopUpButton";
import { Text } from "@/components/ui/Text";

const ROLE_LABEL = { admin: "Admin", coach: "Coach", player: "Player" } as const;

/**
 * Profile in four groups on the grouped floor: who you are, then Team (your
 * team and your club), Account (email, password, appearance, theme),
 * Devices and Help, and a last group to sign out or delete the account,
 * every action a disclosure row rather than a button in a row. Left out
 * on purpose (App Store 3.1.3(c), and no new features): the plan and usage,
 * name and photo editing, the marketing switch, managing the club, and
 * anything that links out to the web.
 */
export default function ProfileScreen() {
  const { user, profile, myOrgs, activeOrg, activeOrgId, activeOrgRole, isPlayerOnly, setActiveOrg, reloadProfile } =
    useAuth();
  const { teamMap, clubTeams } = usePlaylists();
  const colors = useThemeColors();
  const [resetting, setResetting] = useState(false);

  // Clubs only: a personal space is never selectable here (see resolveActiveOrg).
  const clubOptions = useMemo(
    () => myOrgs.filter((o) => !o.isPersonal).map((o) => ({ value: o.orgId, label: o.orgName })),
    [myOrgs],
  );
  const teamNames = [...teamMap.values()].map((t) => t.name);
  const role = activeOrgRole ? ROLE_LABEL[activeOrgRole] : null;

  async function handleChangePassword() {
    if (!user?.email || resetting) return;
    setResetting(true);
    try {
      // As on web: the reset link completes on the web app.
      const { error } = await supabase.auth.resetPasswordForEmail(user.email);
      if (error) Alert.alert("Something went wrong", error.message);
      else Alert.alert("Check your email", "We sent a link to set a new password.");
    } finally {
      setResetting(false);
    }
  }

  const clubName = !isPlayerOnly && activeOrg && !activeOrg.isPersonal ? activeOrg.orgName : null;

  return (
    <Screen title="Profile" large grouped contentClassName="gap-6 px-4 pt-1">
      <View className="-mx-4">
        <LicenseNotice />
      </View>

      {/* Who you are */}
      <View className="flex-row items-center gap-3.5">
        <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={56} />
        <View className="min-w-0 flex-1">
          <Text variant="title2" numberOfLines={2}>
            {profile?.fullName || user?.email?.split("@")[0] || "Your profile"}
          </Text>
          {(role || clubName) && (
            <Text variant="subheadline" numberOfLines={1} className="text-muted-foreground">
              {[role, clubName].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
      </View>

      <View>
        <TeamSection>
          {isPlayerOnly
            ? // Players have no active space: their feed gathers every club. The
              // clubs are listed read-only, with their own team names (the feed's
              // team names carry club prefixes when there are several).
              clubTeams.map((c) => (
                <GroupRow
                  key={c.orgId}
                  icon="club"
                  label={c.orgName}
                  description={c.teamNames.length > 0 ? c.teamNames.join(" · ") : undefined}
                />
              ))
            : activeOrg && !activeOrg.isPersonal
              ? [
                  <GroupRow
                    key="club"
                    icon="club"
                    label={activeOrg.orgName}
                    description={teamNames.length > 0 ? teamNames.join(" · ") : undefined}
                    trailing={role ?? undefined}
                  />,
                  // No "Manage…": the web app reaches the pricing page, and App
                  // Review rejected build 5 for exactly that path (3.1.1 /
                  // 3.1.3(c)). Clubs are managed from the desktop or web app.
                  clubOptions.length > 1 ? (
                    <GroupRow
                      key="switch"
                      label="Switch club"
                      trailing={
                        <PopUpButton
                          accessibilityLabel="Club"
                          title="Club"
                          value={activeOrgId ?? ""}
                          options={clubOptions}
                          onValueChange={async (orgId) => {
                            setActiveOrg(orgId);
                            await reloadProfile();
                          }}
                        />
                      }
                    />
                  ) : null,
                ]
              : null}
        </TeamSection>
      </View>

      <View>
        <GroupHeader title="Account" />
        <GroupedList>
          <GroupRow label="Email" trailing={user?.email ?? ""} />
          <GroupRow
            label="Change password"
            accessibilityLabel="Change password. We'll email you a reset link."
            chevron={!resetting}
            trailing={resetting ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : undefined}
            onPress={handleChangePassword}
          />
          <AppearanceRow />
          <ThemeRow />
        </GroupedList>
      </View>

      <DevicesSection />

      <View>
        <GroupHeader title="Help" />
        <GroupedList inset={46}>
          <GroupRow
            icon="feedback"
            label="Send feedback"
            chevron
            onPress={() => router.push({ pathname: "/feedback", params: { from: "/profile" } })}
          />
        </GroupedList>
      </View>

      <GroupedList>
        <GroupRow
          label="Sign out"
          accessibilityLabel={`Sign out of ${user?.email ?? "Scoutable"}`}
          onPress={() => signOutAndCleanup()}
        />
        <GroupRow label="Delete account" destructive chevron onPress={() => router.push("/delete-account")} />
      </GroupedList>

      <Text variant="footnote" nums className="text-center text-muted-foreground">
        Scoutable {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}
