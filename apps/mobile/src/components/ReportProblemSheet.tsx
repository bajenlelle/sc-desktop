import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { usePathname } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { submitFeedbackReport } from "@scoutable/shared/lib/feedback";
import { Button } from "./Button";

/**
 * "Report a problem" bottom sheet — description only (no screenshot picker in
 * v1); app version, OS and route are attached automatically.
 */
export function ReportProblemSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { activeOrgId } = useAuth();
  const pathname = usePathname();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    const result = await submitFeedbackReport(supabase, {
      description: description.trim(),
      app: "mobile",
      appVersion: Constants.expoConfig?.version ?? "unknown",
      os: `${Platform.OS} ${Platform.Version}`,
      route: pathname,
      orgId: activeOrgId ?? undefined,
      sentryEventId: Sentry.lastEventId() ?? undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      setDescription("");
      onClose();
      Alert.alert("Thanks!", "Your report is in — we'll take a look.");
    } else {
      Alert.alert(
        "Couldn't send the report",
        result.error === "too_many_reports"
          ? "You've sent a few reports recently — please wait a bit before sending another."
          : "Please try again in a moment.",
      );
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
              Send feedback
            </Text>
            <Text className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Found a bug, got an idea, or something confusing? Tell us — your app version and
              current screen are attached automatically.
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              maxLength={4000}
              placeholder="e.g. The video keeps buffering on the second clip…"
              placeholderTextColor="#9ca3af"
              textAlignVertical="top"
              className="mt-4 min-h-[110px] rounded-xl border border-border dark:border-border-dark px-3 py-2.5 text-base text-foreground dark:text-foreground-dark"
            />
            <View className="mt-4 gap-2">
              <Button
                title={submitting ? "Sending…" : "Send feedback"}
                onPress={handleSubmit}
                loading={submitting}
                disabled={!description.trim()}
              />
              <Button title="Cancel" variant="ghost" onPress={handleClose} disabled={submitting} />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
