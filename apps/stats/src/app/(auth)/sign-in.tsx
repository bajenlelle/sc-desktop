import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
import { useColorScheme } from "nativewind";
import { supabase } from "@/lib/supabase";
import { isNativeAppleAvailable, signInWithAppleNative, signInWithProvider } from "@/lib/oauth";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [nativeApple, setNativeApple] = useState(false);
  const { colorScheme } = useColorScheme();

  useEffect(() => {
    let active = true;
    void isNativeAppleAvailable().then((ok) => {
      if (active) setNativeApple(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(provider: "google" | "apple") {
    setError(null);
    setOauthLoading(provider);
    try {
      if (provider === "apple" && nativeApple) await signInWithAppleNative();
      else await signInWithProvider(provider);
    } catch {
      setError(
        `Couldn't sign in with ${provider === "apple" ? "Apple" : "Google"}. Try again, or sign in with your email and password.`,
      );
    } finally {
      setOauthLoading(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-8" keyboardShouldPersistTaps="handled">
          <Text className="font-heading text-4xl text-foreground">Scoutable Stats</Text>
          <Text className="mt-1 text-base text-muted-foreground">
            Keep the stats by voice. Sign in with the account you use on your computer.
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
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            <Button title="Sign in" onPress={handleSignIn} loading={submitting} disabled={!email.trim() || !password} />
            <Link href="/sign-up" asChild>
              <Text className="text-center text-sm text-primary">New here? Create an account</Text>
            </Link>
          </View>

          <View className="my-6 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <Text className="text-xs uppercase text-muted-foreground">or</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <View className="gap-3">
            <Button
              title="Continue with Google"
              variant="outline"
              onPress={() => handleOAuth("google")}
              loading={oauthLoading === "google"}
            />
            {nativeApple ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  colorScheme === "dark"
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={8}
                style={{ height: 48 }}
                onPress={() => handleOAuth("apple")}
              />
            ) : (
              <Button
                title="Continue with Apple"
                variant="outline"
                onPress={() => handleOAuth("apple")}
                loading={oauthLoading === "apple"}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
