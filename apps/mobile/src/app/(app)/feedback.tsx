import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { submitFeedbackReport } from "@scoutable/shared/lib/feedback";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { successHaptic } from "@/lib/haptics";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";

/**
 * Send feedback, as a form sheet over the screen it was opened from (the
 * web's ReportProblemDialog): a description, with the app version, OS and
 * that screen's route attached.
 */
export default function FeedbackSheet() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { activeOrgId } = useAuth();
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    const result = await submitFeedbackReport(supabase, {
      description: description.trim(),
      app: "mobile",
      appVersion: Constants.expoConfig?.version ?? "unknown",
      os: `${Platform.OS} ${Platform.Version}`,
      route: typeof from === "string" && from ? from : "/profile",
      orgId: activeOrgId ?? undefined,
      sentryEventId: Sentry.lastEventId() ?? undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      successHaptic();
      router.back();
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
    <View className="gap-4 bg-background px-5 pb-8 pt-6">
      <View className="gap-1.5">
        <Text variant="title3">Send feedback</Text>
        <Text variant="callout" className="text-muted-foreground">
          Found a bug, got an idea, or something confusing? Tell us — your app version and current screen are attached
          automatically.
        </Text>
      </View>
      <TextField
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
        placeholder="e.g. The video keeps buffering on the second clip…"
        accessibilityLabel="What happened"
        autoFocus
      />
      <View className="gap-2">
        <Button onPress={handleSubmit} loading={submitting} disabled={!description.trim()}>
          {submitting ? "Sending…" : "Send feedback"}
        </Button>
        <Button variant="ghost" onPress={() => router.back()} disabled={submitting}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
