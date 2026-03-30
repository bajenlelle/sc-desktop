import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../components/auth-context";
import { updateMyProfile } from "../../lib/profile-db";
import { supabase } from "../../lib/supabase";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, reloadProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSave() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await updateMyProfile({ fullName: fullName.trim() });
      await reloadProfile();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="px-4 py-6"
      style={{ paddingTop: insets.top }}
    >
      <Text className="text-2xl font-bold text-gray-900 mb-6">Profile</Text>

      {/* Email (read-only) */}
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
        <View className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
          <Text className="text-gray-500">{user?.email}</Text>
        </View>
      </View>

      {/* Role */}
      {profile?.role && (
        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 mb-1">Role</Text>
          <View className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
            <Text className="text-gray-500 capitalize">{profile.role}</Text>
          </View>
        </View>
      )}

      {/* Full name */}
      <View className="mb-6">
        <Text className="text-sm font-medium text-gray-700 mb-1">Full name</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
      </View>

      <TouchableOpacity
        className="bg-primary rounded-lg py-3 items-center mb-8"
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Save changes</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="border border-red-300 rounded-lg py-3 items-center"
        onPress={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? (
          <ActivityIndicator color="#ef4444" />
        ) : (
          <Text className="text-red-600 font-medium">Sign out</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
