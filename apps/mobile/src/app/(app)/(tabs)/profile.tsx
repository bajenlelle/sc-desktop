import { useMemo, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { DeleteAccountSheet } from "@/components/DeleteAccountSheet";
import { ReportProblemSheet } from "@/components/ReportProblemSheet";
import { Select } from "@/components/Select";

export default function ProfileScreen() {
  const { user, profile, myOrgs, activeOrg, activeOrgId, isPlayerOnly, setActiveOrg, reloadProfile } =
    useAuth();
  const { teamMap, clubTeams } = usePlaylists();
  const [resetting, setResetting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const orgOptions = useMemo(
    () => myOrgs.map((o) => ({ value: o.orgId, label: o.orgName })),
    [myOrgs]
  );

  const teamNames = [...teamMap.values()].map((t) => t.name);

  async function handleChangePassword() {
    if (!user?.email || resetting) return;
    setResetting(true);
    try {
      // Web parity: the reset link completes on the web app.
      const { error } = await supabase.auth.resetPasswordForEmail(user.email);
      if (error) Alert.alert("Something went wrong", error.message);
      else
        Alert.alert("Check your email", "We sent a link to set a new password.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background dark:bg-background-dark">
      {/* Tab root — no back affordance. */}
      <View className="flex-row items-center px-4 pb-1 pt-3">
        <Text className="font-heading text-2xl text-foreground dark:text-foreground-dark">
          Profile
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-6 px-4 py-4">
        <View className="flex-row items-center gap-4">
          <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={56} />
          <View className="min-w-0 flex-1">
            <Text
              numberOfLines={1}
              className="text-lg font-semibold text-foreground dark:text-foreground-dark"
            >
              {profile?.fullName ?? "—"}
            </Text>
            <Text
              numberOfLines={1}
              className="text-sm text-muted-foreground dark:text-muted-foreground-dark"
            >
              {user?.email}
            </Text>
          </View>
        </View>

        {isPlayerOnly ? (
          // Player-only users have no active-space concept — their feed
          // aggregates every club. Read-only membership list, raw team names
          // (teamMap values carry club prefixes in the multi-club feed).
          <View className="gap-3 rounded-xl border border-border dark:border-border-dark p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
              {clubTeams.length > 1 ? "My clubs" : "My club"}
            </Text>
            {clubTeams.map((c) => (
              <View key={c.orgId}>
                <Text className="text-base text-foreground dark:text-foreground-dark">
                  {c.orgName}
                </Text>
                {c.teamNames.length > 0 && (
                  <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
                    {c.teamNames.join(" · ")}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View className="gap-2 rounded-xl border border-border dark:border-border-dark p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
              Club
            </Text>
            {myOrgs.length > 1 ? (
              <Select
                options={orgOptions}
                value={activeOrgId ?? ""}
                onChange={async (orgId) => {
                  setActiveOrg(orgId);
                  await reloadProfile();
                }}
              />
            ) : (
              <Text className="text-base text-foreground dark:text-foreground-dark">
                {activeOrg?.orgName ?? "—"}
              </Text>
            )}
            {teamNames.length > 0 && (
              <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
                {teamNames.join(" · ")}
              </Text>
            )}
          </View>
        )}

        <View className="gap-3">
          <Button
            title="Change password"
            variant="outline"
            onPress={handleChangePassword}
            loading={resetting}
          />
          <Button
            title="Send feedback"
            variant="outline"
            onPress={() => setReportOpen(true)}
          />
          <Button
            title="Sign out"
            variant="ghost"
            onPress={() => supabase.auth.signOut()}
          />
          <Button
            title="Delete account"
            variant="destructive"
            onPress={() => setDeleteOpen(true)}
          />
        </View>

        <Text className="text-center text-xs text-muted-foreground dark:text-muted-foreground-dark">
          Scoutable {Constants.expoConfig?.version ?? ""}
        </Text>
      </ScrollView>

      <DeleteAccountSheet
        visible={deleteOpen}
        email={user?.email ?? ""}
        onClose={() => setDeleteOpen(false)}
      />

      <ReportProblemSheet visible={reportOpen} onClose={() => setReportOpen(false)} />
    </SafeAreaView>
  );
}
