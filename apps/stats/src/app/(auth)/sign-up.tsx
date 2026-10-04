import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export default function SignUp() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            // Parents and players keep stats; "player" keeps the reader app's
            // copy and analytics sensible if they ever open it.
            declared_role: "player",
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
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 justify-center px-6">
          <Text className="font-heading text-3xl text-foreground">Check your email</Text>
          <Text className="mt-2 text-base text-muted-foreground">
            We sent a confirmation link to {email.trim()}. Open it, then come back and sign in.
          </Text>
          <Link href="/sign-in" asChild>
            <Text className="mt-6 text-center text-sm text-primary">Back to sign in</Text>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-8" keyboardShouldPersistTaps="handled">
          <Text className="font-heading text-4xl text-foreground">Create your account</Text>
          <Text className="mt-1 text-base text-muted-foreground">
            Your name is shown as the keeper when you publish a game's stats.
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
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
            <Input label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={handleSignUp} />
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            <Button
              title="Create account"
              onPress={handleSignUp}
              loading={submitting}
              disabled={!firstName.trim() || !email.trim() || !password || !confirm}
            />
            <Link href="/sign-in" asChild>
              <Text className="text-center text-sm text-primary">Already have an account? Sign in</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
