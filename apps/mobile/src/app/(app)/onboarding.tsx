import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { joinByCode } from "@scoutable/shared/lib/profile-db";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

/** Accepts a raw code or a pasted /join/<code> URL (same regex as web). */
function extractCode(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/join\/([A-Za-z0-9]{4,10})(?:\?|#|\/|$)/);
  return (urlMatch ? urlMatch[1] : trimmed).toUpperCase();
}

export default function Onboarding() {
  const { setActiveOrg, reloadProfile } = useAuth();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleJoin() {
    setError(null);
    setSubmitting(true);
    try {
      const code = extractCode(input);
      const result = await joinByCode(supabase, code);
      trackEvent("org_joined", { org_id: result.orgId });
      // Order matters: persist the org choice before the reload resolves it.
      setActiveOrg(result.orgId);
      await reloadProfile();
      router.replace("/playlists");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-8"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-heading text-4xl text-foreground dark:text-foreground-dark">
            Join your club
          </Text>
          <Text className="mt-2 text-base text-muted-foreground dark:text-muted-foreground-dark">
            Enter the invite code from your coach, or paste the invite link.
          </Text>

          <View className="mt-8 gap-4">
            <Input
              value={input}
              onChangeText={setInput}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABC123 or invite link"
              onSubmitEditing={handleJoin}
            />
            {error ? (
              <Text className="text-sm text-destructive dark:text-destructive-dark">{error}</Text>
            ) : null}
            <Button title="Join" onPress={handleJoin} loading={submitting} disabled={!input.trim()} />
            <Button title="Sign out" variant="ghost" onPress={handleSignOut} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
