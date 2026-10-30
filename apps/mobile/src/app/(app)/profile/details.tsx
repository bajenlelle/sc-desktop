import { useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useThemeColors } from "@/lib/theme-context";
import { Avatar } from "@/components/Avatar";
import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { useRoleLine } from "@/components/settings/AccountCard";
import { GroupFooter, GroupRow, GroupedList } from "@/components/ui/Group";
import { Text } from "@/components/ui/Text";

/**
 * Settings › Profile, as Claude's: the picture large, then your name and
 * email, the password, and Delete account last, apart and in red. The photo
 * is changed from the web or desktop app for now (a picker is a native
 * module, so it waits for a store build).
 */
export default function ProfilePage() {
  const { user, profile } = useAuth();
  const colors = useThemeColors();
  const roleLine = useRoleLine();
  const [resetting, setResetting] = useState(false);

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
    <Screen title="Profile" sheet leading={<SheetBackButton />} grouped contentClassName="gap-6 px-4 pt-2">
      <View className="items-center gap-2">
        <Avatar name={profile?.fullName} url={profile?.avatarUrl} size={96} />
        {roleLine ? (
          <Text variant="subheadline" className="text-muted-foreground">
            {roleLine}
          </Text>
        ) : null}
      </View>

      <View>
        <GroupedList large>
          <GroupRow large label="Name" trailing={profile?.fullName || "Not set"} />
          <GroupRow large label="Email" trailing={user?.email ?? ""} />
        </GroupedList>
        <GroupFooter>Your name shows on the playlists you share and in your club.</GroupFooter>
      </View>

      <View>
        <GroupedList large>
          <GroupRow
            large
            label="Change password"
            accessibilityLabel="Change password. We'll email you a reset link."
            chevron={!resetting}
            trailing={resetting ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : undefined}
            onPress={handleChangePassword}
          />
        </GroupedList>
        <GroupFooter>We&apos;ll email you a link to set a new one.</GroupFooter>
      </View>

      <GroupedList large>
        <GroupRow
          large
          icon="trash"
          label="Delete account"
          destructive
          chevron
          onPress={() => router.push("/profile/delete-account")}
        />
      </GroupedList>
    </Screen>
  );
}
