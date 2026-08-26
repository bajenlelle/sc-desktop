import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { deleteAccount, mapDeleteAccountError } from "@/lib/account";
import { Button } from "./Button";
import { Input } from "./Input";

/**
 * Typed-confirm bottom sheet for account erasure — a double Alert is one
 * reflexive thumb-tap away from irreversible; typing DELETE is deliberate.
 * Matches the web/desktop dialogs' confirm word.
 */
export function DeleteAccountSheet({
  visible,
  email,
  onClose,
}: {
  visible: boolean;
  email: string;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (deleting) return;
    setConfirmText("");
    setError(null);
    onClose();
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setError(mapDeleteAccountError(result));
      setDeleting(false);
      return;
    }
    // The server already revoked the user; local sign-out flips the auth
    // listener, which redirects to sign-in — no manual navigation.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore — session is dead either way
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={handleClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable
            className="rounded-t-2xl bg-card dark:bg-card-dark px-5 pb-10 pt-2"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mx-auto my-2 h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
            <Text className="text-lg font-semibold text-foreground dark:text-foreground-dark">
              Delete account?
            </Text>
            <Text className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground-dark">
              This permanently deletes the account{" "}
              <Text className="font-semibold text-foreground dark:text-foreground-dark">
                {email}
              </Text>{" "}
              — including your games, playlists, shared links and watch history. Any active
              subscription is canceled. This can&apos;t be undone.
            </Text>
            <View className="mt-4 gap-3">
              <Input
                label="Type DELETE to confirm"
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="DELETE"
                autoCapitalize="characters"
                autoCorrect={false}
                error={error}
              />
              <Button
                title="Delete account"
                variant="destructive"
                loading={deleting}
                disabled={confirmText !== "DELETE"}
                onPress={handleDelete}
              />
              <Button title="Cancel" variant="ghost" onPress={handleClose} disabled={deleting} />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
