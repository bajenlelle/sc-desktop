import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { AuthError, AuthFootnote, AuthHeading, AuthShell, AuthStatus, FieldGroup, GroupField } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

function backToSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace("/sign-in");
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // The reset link completes on the web app, as before.
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (err) setError(err.message);
      else setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <AuthStatus title="Check your inbox">
            If an account exists for <Text variant="subheadline" className="font-semibold text-foreground">{email.trim()}</Text>, a reset link is
            on its way. Open it to set a new password, then sign in here.
        </AuthStatus>
        <AuthFootnote>
          <Text variant="subheadline" accessibilityRole="link" onPress={backToSignIn} className="font-semibold text-primary">
            Back to sign in
          </Text>
        </AuthFootnote>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading title="Reset your password" description="We'll email you a link to set a new one." />
      <View className="gap-3">
        <FieldGroup>
          <GroupField
            accessibilityLabel="Email"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={handleReset}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button onPress={handleReset} loading={submitting} disabled={!email.trim()}>
          Send reset link
        </Button>
      </View>
      <AuthFootnote>
        <Text variant="subheadline" accessibilityRole="link" onPress={backToSignIn} className="font-semibold text-primary">
          Back to sign in
        </Text>
      </AuthFootnote>
    </AuthShell>
  );
}
