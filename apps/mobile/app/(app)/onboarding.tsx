import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { joinByCode, getInvitePreview } from "../../lib/profile-db";
import { useAuth } from "../../components/auth-context";

export default function OnboardingScreen() {
  const router = useRouter();
  const { reloadProfile } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    orgName?: string;
    teamName?: string | null;
    role?: string;
  } | null>(null);

  async function handlePreview() {
    if (code.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getInvitePreview(code);
      if (result.valid) {
        setPreview({ orgName: result.orgName, teamName: result.teamName, role: result.role });
      } else {
        setError("Invalid invite code.");
        setPreview(null);
      }
    } catch (err: any) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      await joinByCode(code);
      await reloadProfile();
      router.replace("/(app)/playlists");
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-sm">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Join your team</Text>
          <Text className="text-gray-500 mb-8">
            Enter the invite code your coach or admin sent you.
          </Text>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <Text className="text-red-700 text-sm">{error}</Text>
            </View>
          )}

          {preview && (
            <View className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <Text className="text-blue-900 font-semibold">{preview.orgName}</Text>
              {preview.teamName && (
                <Text className="text-blue-700 text-sm">{preview.teamName}</Text>
              )}
              {preview.role && (
                <Text className="text-blue-600 text-sm capitalize">{preview.role}</Text>
              )}
            </View>
          )}

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Invite code</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white uppercase tracking-widest"
              placeholder="e.g. ABC123"
              autoCapitalize="characters"
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase());
                setPreview(null);
                setError(null);
              }}
              onBlur={handlePreview}
            />
          </View>

          <TouchableOpacity
            className="bg-primary rounded-lg py-3 items-center"
            onPress={preview ? handleJoin : handlePreview}
            disabled={loading || code.length < 4}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {preview ? "Join" : "Look up code"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
