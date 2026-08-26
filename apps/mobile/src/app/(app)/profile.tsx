import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { DeleteAccountSheet } from "@/components/DeleteAccountSheet";
import { Select } from "@/components/Select";

export default function ProfileScreen() {
  const { user, profile, myOrgs, activeOrg, activeOrgId, setActiveOrg, reloadProfile } = useAuth();
  const { teamMap } = usePlaylists();
  const [resetting, setResetting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      <View className="flex-row items-center gap-2 px-2 pb-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Text className="text-2xl text-foreground dark:text-foreground-dark">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-foreground dark:text-foreground-dark">
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

        <View className="gap-3">
          <Button
            title="Change password"
            variant="outline"
            onPress={handleChangePassword}
            loading={resetting}
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
    </SafeAreaView>
  );
}
