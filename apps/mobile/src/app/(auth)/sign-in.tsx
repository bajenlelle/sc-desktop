import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { signInWithProvider } from "@/lib/oauth";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) setError(err.message);
      // Success: the auth listener flips state and (auth)/_layout redirects.
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(provider: "google" | "apple") {
    setError(null);
    setOauthLoading(provider);
    try {
      await signInWithProvider(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setOauthLoading(null);
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
            Welcome back
          </Text>
          <Text className="mt-1 text-base text-muted-foreground dark:text-muted-foreground-dark">
            Sign in to watch your playlists
          </Text>

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
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              placeholder="••••••••"
              onSubmitEditing={handleSignIn}
            />
            {error ? (
              <Text className="text-sm text-destructive dark:text-destructive-dark">{error}</Text>
            ) : null}
            <Button
              title="Sign in"
              onPress={handleSignIn}
              loading={submitting}
              disabled={!email.trim() || !password}
            />
            <Link href="/forgot-password" asChild>
              <Text className="text-center text-sm text-primary dark:text-primary-dark">
                Forgot your password?
              </Text>
            </Link>
          </View>

          <View className="my-6 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
            <Text className="text-xs uppercase text-muted-foreground dark:text-muted-foreground-dark">
              or
            </Text>
            <View className="h-px flex-1 bg-border dark:bg-border-dark" />
          </View>

          <View className="gap-3">
            <Button
              title="Continue with Google"
              variant="outline"
              onPress={() => handleOAuth("google")}
              loading={oauthLoading === "google"}
            />
            <Button
              title="Continue with Apple"
              variant="outline"
              onPress={() => handleOAuth("apple")}
              loading={oauthLoading === "apple"}
            />
          </View>

          <View className="mt-8 flex-row justify-center gap-1">
            <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
              New to Scoutable?
            </Text>
            <Link href="/sign-up" asChild>
              <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
                Create an account
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
