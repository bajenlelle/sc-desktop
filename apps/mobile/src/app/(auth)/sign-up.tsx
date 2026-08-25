import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

type DeclaredRole = "coach" | "player";

export default function SignUp() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Mobile is the player app — default the toggle to "player" (web has no default).
  const [role, setRole] = useState<DeclaredRole>("player");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            declared_role: role,
          },
        },
      });
      if (err) setError(err.message);
      else setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background dark:bg-background-dark px-6">
        <Text className="font-heading text-3xl text-foreground dark:text-foreground-dark">
          Check your email
        </Text>
        <Text className="mt-2 text-center text-base text-muted-foreground dark:text-muted-foreground-dark">
          We sent a confirmation link to {email.trim()}. Confirm your address, then come back and
          sign in.
        </Text>
        <Link href="/sign-in" asChild>
          <Text className="mt-6 text-base font-semibold text-primary dark:text-primary-dark">
            Back to sign in
          </Text>
        </Link>
      </SafeAreaView>
    );
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
            Create account
          </Text>

          <View className="mt-8 gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input label="First name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
              </View>
              <View className="flex-1">
                <Input label="Last name" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
              </View>
            </View>

            <View>
              <Text className="mb-1.5 text-sm font-medium text-foreground dark:text-foreground-dark">
                I&apos;m a…
              </Text>
              <View className="flex-row gap-3">
                {(["player", "coach"] as const).map((r) => (
                  <Pressable
                    key={r}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: role === r }}
                    onPress={() => setRole(r)}
                    className={`min-h-[48px] flex-1 items-center justify-center rounded-lg border ${
                      role === r
                        ? "border-primary dark:border-primary-dark bg-primary/10"
                        : "border-border dark:border-border-dark"
                    }`}
                  >
                    <Text
                      className={`text-base font-semibold ${
                        role === r
                          ? "text-primary dark:text-primary-dark"
                          : "text-foreground dark:text-foreground-dark"
                      }`}
                    >
                      {r === "player" ? "Player" : "Coach"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <Input
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
            />
            {error ? (
              <Text className="text-sm text-destructive dark:text-destructive-dark">{error}</Text>
            ) : null}
            <Button
              title="Create account"
              onPress={handleSignUp}
              loading={submitting}
              disabled={!firstName.trim() || !email.trim() || !password || !confirm}
            />
          </View>

          <View className="mt-8 flex-row justify-center gap-1">
            <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Already have an account?
            </Text>
            <Link href="/sign-in" asChild>
              <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
                Sign in
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
