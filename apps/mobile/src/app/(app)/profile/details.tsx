import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, StyleSheet, TextInput, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { updateMyFullName } from "@scoutable/shared/lib/profile-db";
import { FULL_NAME_MAX, normalizeFullName } from "@scoutable/shared/lib/profile-name";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { interStyle } from "@/lib/fonts";
import { successHaptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme-context";
import { Avatar } from "@/components/Avatar";
import { GlassButton, SheetBackButton } from "@/components/shell/GlassButton";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/shell/Screen";
import { useRoleLine } from "@/components/settings/AccountCard";
import { GroupFooter, GroupRow, GroupedList } from "@/components/ui/Group";
import { Text } from "@/components/ui/Text";

/**
 * Settings › Profile, as Claude's: the picture large, then your name (edited
 * in place, saved with the check in the bar) and email, the password, and
 * Delete account last, apart and in red. Leaving with an unsaved name asks
 * first, by Back or by swiping the sheet down (iOS holds the sheet and the
 * same question comes up, as the HIG asks). The photo is changed
 * from the web or desktop app for now (a picker is a native module, so it
 * waits for a store build).
 */
export default function ProfilePage() {
  const { user, profile, patchProfile } = useAuth();
  const colors = useThemeColors();
  const navigation = useNavigation();
  const roleLine = useRoleLine();
  const [resetting, setResetting] = useState(false);

  const savedName = profile?.fullName ?? "";
  // The field follows the loaded name until the user types in it, so a
  // profile that arrives late fills it rather than reading as an edit.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? savedName;
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const leftRef = useRef(false);
  const next = normalizeFullName(name);
  const dirty = (next ?? "") !== (normalizeFullName(savedName) ?? "");
  const canSave = dirty && next !== null && !saving;

  // An unsaved name: Back, Android back and a swipe on the sheet ask first.
  usePreventRemove(dirty && !saving, ({ data }) => {
    Keyboard.dismiss();
    Alert.alert("Discard changes?", "Your new name hasn't been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Back to Settings once, after the save, when the field matches the
  // profile again (so the guard above is off). Not if another page was
  // pushed over this one meanwhile.
  useEffect(() => {
    if (!justSaved || dirty || leftRef.current || !navigation.isFocused()) return;
    leftRef.current = true;
    navigation.goBack();
  }, [justSaved, dirty, navigation]);

  async function handleSave() {
    if (!canSave || !user || next === null) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await updateMyFullName(supabase, user.id, next);
    } catch {
      setSaving(false);
      Alert.alert("Couldn't save your name", "Check your connection and try again.");
      return;
    }
    // The saved value goes straight into the loaded profile: no reload,
    // which would refetch the feed behind the sheet.
    patchProfile({ fullName: next });
    setDraft(null);
    setSaving(false);
    successHaptic();
    setJustSaved(true);
  }

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
    <Screen
      title="Profile"
      sheet
      leading={<SheetBackButton />}
      trailing={
        <GlassButton accessibilityLabel="Save" disabled={!canSave} busy={saving} onPress={handleSave}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Icon name="check" size={20} strokeWidth={2.25} color={colors.foreground} />
          )}
        </GlassButton>
      }
      grouped
      contentClassName="gap-6 px-4 pt-2"
    >
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
          <View className="min-h-[52px] flex-row items-center gap-3 px-4">
            {/* The field carries the same label for screen readers. */}
            <Text accessibilityElementsHidden importantForAccessibility="no">
              Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setDraft}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              maxLength={FULL_NAME_MAX}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSave}
              editable={!saving}
              accessibilityLabel="Name"
              style={[styles.input, { color: colors.foreground }, interStyle(400)]}
            />
          </View>
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

const styles = StyleSheet.create({
  // Body text, ending at the row's right edge like the other rows' values.
  input: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, textAlign: "right", paddingVertical: 14 },
});
