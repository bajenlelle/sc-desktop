import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { signOutAndCleanup } from "@/lib/notifications";
import { usePlaylists } from "@/lib/playlists-store";
import { useThemeColors } from "@/lib/theme-context";
import { AppearanceSection } from "@/components/AppearanceSection";
import { Screen } from "@/components/shell/Screen";
import { Avatar } from "@/components/Avatar";
import { DevicesSection } from "@/components/DevicesSection";
import { LicenseNotice } from "@/components/LicenseNotice";
import { TeamSection } from "@/components/TeamSection";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
import { Icon } from "@/components/ui/Icon";
import { PopUpButton } from "@/components/ui/PopUpButton";
import { Text } from "@/components/ui/Text";

const ROLE_LABEL = { admin: "Admin", coach: "Coach", player: "Player" } as const;

/**
 * Profile, as the web's at phone width: who you are, then grouped lists for
 * your team, your club, the account, appearance, devices and help. Left out
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

  return (
    <Screen title="Profile" large grouped contentClassName="gap-7 px-4 pt-2">
      <LicenseNotice />

      {/* Who you are */}
      <View className="flex-row items-center gap-4">
        <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={64} />
        <View className="min-w-0 flex-1 gap-1">
          <Text variant="title1" numberOfLines={2}>
            {profile?.fullName || user?.email?.split("@")[0] || "—"}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {role && <Badge variant={activeOrgRole === "admin" ? "default" : activeOrgRole === "coach" ? "secondary" : "outline"}>{role}</Badge>}
            {!isPlayerOnly && activeOrg && !activeOrg.isPersonal && (
              <View className="min-w-0 flex-row items-center gap-1">
                <Icon name="club" size={13} color={colors.mutedForeground} />
                <Text variant="callout" numberOfLines={1} className="shrink text-muted-foreground">
                  {activeOrg.orgName}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <TeamSection />

      {isPlayerOnly ? (
        // Players have no active space: their feed gathers every club. The
        // clubs are listed read-only, with their own team names (the feed's
        // team names carry club prefixes when there are several).
        clubTeams.length > 0 && (
          <View>
            <GroupHeader title={clubTeams.length > 1 ? "My clubs" : "My club"} />
            <GroupedList>
              {clubTeams.map((c) => (
                <GroupRow
                  key={c.orgId}
                  icon="club"
                  label={c.orgName}
                  description={c.teamNames.length > 0 ? c.teamNames.join(" · ") : undefined}
                />
              ))}
            </GroupedList>
          </View>
        )
      ) : (
        activeOrg &&
        !activeOrg.isPersonal && (
          <View>
            <GroupHeader title="Club" />
            <GroupedList>
              <GroupRow
                icon="club"
                label={activeOrg.orgName}
                description={teamNames.length > 0 ? teamNames.join(" · ") : undefined}
                trailing={role ?? undefined}
              />
              {/* No "Manage…": the web app reaches the pricing page, and App
                  Review rejected build 5 for exactly that path (3.1.1 /
                  3.1.3(c)). Clubs are managed from the desktop or web app. */}
              {clubOptions.length > 1 && (
                <GroupRow
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
              )}
            </GroupedList>
          </View>
        )
      )}

      <View>
        <GroupHeader title="Account" />
        <GroupedList>
          <GroupRow label="Email" trailing={user?.email ?? ""} />
          <GroupRow
            label="Password"
            description="We'll email you a reset link"
            trailing={
              <Button variant="outline" size="xs" loading={resetting} onPress={handleChangePassword}>
                Change…
              </Button>
            }
          />
        </GroupedList>
      </View>

      <AppearanceSection />

      <DevicesSection />

      <View>
        <GroupHeader title="Help" />
        <GroupedList>
          <GroupRow
            icon="feedback"
            label="Send feedback…"
            chevron
            onPress={() => router.push({ pathname: "/feedback", params: { from: "/profile" } })}
          />
        </GroupedList>
      </View>

      <GroupedList>
        <GroupRow icon="signOut" label={`Sign out of ${user?.email ?? "Scoutable"}`} onPress={() => signOutAndCleanup()} />
      </GroupedList>

      <View>
        <GroupHeader title="Delete account" />
        <GroupedList>
          <GroupRow
            label="Delete account"
            description="Permanently erase your account and everything in it."
            trailing={
              <Button variant="outline" size="xs" textClassName="text-destructive" onPress={() => router.push("/delete-account")}>
                Delete…
              </Button>
            }
          />
        </GroupedList>
      </View>

      <Text variant="footnote" nums className="text-center text-muted-foreground">
        Scoutable {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}
