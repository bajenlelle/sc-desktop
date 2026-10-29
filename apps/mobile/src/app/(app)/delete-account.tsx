import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { deleteAccount, mapDeleteAccountError } from "@/lib/account";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";

/**
 * Account erasure, as a form sheet with a typed confirmation: a double alert
 * is one reflexive tap away from irreversible; typing DELETE is deliberate.
 * The same confirm word as the web and desktop dialogs.
 */
export default function DeleteAccountSheet() {
  const { user } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setError(mapDeleteAccountError(result));
      setDeleting(false);
      return;
    }
    // The server already revoked the user; signing out locally flips the
    // auth listener, which redirects to sign-in. No manual navigation.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The session is dead either way.
    }
  }

  return (
    <View className="gap-4 bg-background px-5 pb-8 pt-6">
      <View className="gap-1.5">
        <Text variant="title3">Delete account?</Text>
        <Text variant="callout" className="text-muted-foreground">
          This permanently deletes the account <Text variant="callout" className="font-semibold">{user?.email ?? ""}</Text> —
          including your games, playlists, shared links and watch history. Any active subscription is canceled. This
          can&apos;t be undone.
        </Text>
      </View>
      <TextField
        label="Type DELETE to confirm"
        value={confirmText}
        onChangeText={setConfirmText}
        placeholder="DELETE"
        autoCapitalize="characters"
        autoCorrect={false}
        error={error}
      />
      <View className="gap-2">
        <Button variant="destructive" loading={deleting} disabled={confirmText !== "DELETE"} onPress={handleDelete}>
          Delete account
        </Button>
        <Button variant="ghost" onPress={() => router.back()} disabled={deleting}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
