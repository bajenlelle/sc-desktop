import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { joinByCode } from "@scoutable/shared/lib/profile-db";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { signOutAndCleanup } from "@/lib/notifications";
import { useAuth } from "@/lib/auth-context";
import { successHaptic } from "@/lib/haptics";
import { AuthError, AuthHeading, AuthShell, FieldGroup, GroupField } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";

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
    if (!input.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const code = extractCode(input);
      const result = await joinByCode(supabase, code);
      trackEvent("org_joined", { org_id: result.orgId });
      successHaptic();
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

  return (
    <AuthShell>
      <AuthHeading title="Join your club" description="Enter the invite code from your coach, or paste the invite link." />
      <View className="gap-3">
        <FieldGroup>
          <GroupField
            accessibilityLabel="Invite code or link"
            placeholder="ABC123 or invite link"
            value={input}
            onChangeText={setInput}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="join"
            onSubmitEditing={handleJoin}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button onPress={handleJoin} loading={submitting} disabled={!input.trim()}>
          Join
        </Button>
        <Button variant="link" size="xs" textClassName="font-medium text-muted-foreground" onPress={() => signOutAndCleanup()}>
          Sign out
        </Button>
      </View>
    </AuthShell>
  );
}
