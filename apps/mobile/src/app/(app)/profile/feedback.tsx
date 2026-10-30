import { useState } from "react";
import { Alert, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { submitFeedbackReport } from "@scoutable/shared/lib/feedback";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { successHaptic } from "@/lib/haptics";
import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { TextField } from "@/components/ui/TextField";

/**
 * Send feedback, a page of the settings sheet (the web's
 * ReportProblemDialog): a description, with the app version, OS and the
 * route it was opened from attached. Back leaves it unsent.
 */
export default function FeedbackPage() {
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
      Alert.alert("Thanks!", "Your report is in. We'll take a look.");
    } else {
      Alert.alert(
        "Couldn't send the report",
        result.error === "too_many_reports"
          ? "You've sent a few reports recently. Please wait a bit before sending another."
          : "Please try again in a moment.",
      );
    }
  }

  return (
    <Screen title="Send feedback" sheet leading={<SheetBackButton />} contentClassName="gap-4 px-4 pt-2">
      <Text variant="subheadline" className="text-muted-foreground">
        Found a bug, got an idea, or something confusing? Tell us. Your app version and current screen are attached
        automatically.
      </Text>
      <TextField
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
        placeholder="e.g. The video keeps buffering on the second clip…"
        accessibilityLabel="What happened"
        autoFocus
      />
      <Button onPress={handleSubmit} loading={submitting} disabled={!description.trim()}>
        {submitting ? "Sending…" : "Send feedback"}
      </Button>
    </Screen>
  );
}
