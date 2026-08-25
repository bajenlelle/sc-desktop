import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    setError(null);
    setSubmitting(true);
    try {
      // The reset link completes on the web app, same as today.
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (err) setError(err.message);
      else setSent(true);
    } finally {
      setSubmitting(false);
    }
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
            Reset password
          </Text>
          {sent ? (
            <>
              <Text className="mt-2 text-base text-muted-foreground dark:text-muted-foreground-dark">
                If an account exists for {email.trim()}, a reset link is on its way. Open it to set
                a new password, then sign in here.
              </Text>
              <Link href="/sign-in" asChild>
                <Text className="mt-6 text-base font-semibold text-primary dark:text-primary-dark">
                  Back to sign in
                </Text>
              </Link>
            </>
          ) : (
            <View className="mt-8 gap-4">
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
              />
              {error ? (
                <Text className="text-sm text-destructive dark:text-destructive-dark">{error}</Text>
              ) : null}
              <Button
                title="Send reset link"
                onPress={handleReset}
                loading={submitting}
                disabled={!email.trim()}
              />
              <Link href="/sign-in" asChild>
                <Text className="text-center text-sm text-primary dark:text-primary-dark">
                  Back to sign in
                </Text>
              </Link>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
