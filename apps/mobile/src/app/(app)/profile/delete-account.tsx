import { useState } from "react";
import { View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { deleteAccount, mapDeleteAccountError } from "@/lib/account";
import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";

/**
 * Account erasure, a page of the settings sheet with a typed confirmation: a
 * double alert is one reflexive tap away from irreversible; typing DELETE is
 * deliberate. The same confirm word as the web and desktop dialogs. Back
 * leaves without deleting.
 */
export default function DeleteAccountPage() {
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
    <Screen title="Delete account" sheet leading={<SheetBackButton />} contentClassName="gap-4 px-4 pt-2">
      <View className="gap-1">
        <Text variant="title3" accessibilityRole="header">
          Delete account?
        </Text>
        <Text variant="subheadline" className="text-muted-foreground">
          This permanently deletes the account <Text variant="subheadline" className="font-semibold text-foreground">{user?.email ?? ""}</Text>,
          including your games, playlists, shared links and watch history. Any active subscription is cancelled. This
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
      <Button variant="destructive" loading={deleting} disabled={confirmText !== "DELETE"} onPress={handleDelete}>
        Delete account
      </Button>
    </Screen>
  );
}
