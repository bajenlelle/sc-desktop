import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, type TextInput } from "react-native";
import { router } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "@/lib/supabase";
import { isNativeAppleAvailable, signInWithAppleNative, signInWithProvider } from "@/lib/oauth";
import { useAppTheme } from "@/lib/theme-context";
import {
  AppleLogo,
  AuthDivider,
  AuthError,
  AuthFootnote,
  AuthHeading,
  AuthShell,
  FieldGroup,
  GoogleLogo,
  GroupField,
} from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";
import { Tappable } from "@/components/ui/Tappable";
import { Text } from "@/components/ui/Text";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  // Apple's own button on iOS (the HIG requires its styling); Android signs
  // in with Apple through the browser, behind the web's black button.
  const [nativeApple, setNativeApple] = useState(false);
  const { resolvedMode } = useAppTheme();
  const passwordRef = useRef<TextInput>(null);

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
    if (!email.trim() || !password || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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
      if (provider === "apple" && nativeApple) await signInWithAppleNative();
      else await signInWithProvider(provider);
      // Success: the auth listener flips state and (auth)/_layout redirects.
    } catch {
      // Provider errors ("invalid_client", "Unacceptable audience") tell the
      // player nothing they can act on: name the way back in instead.
      setError(
        `Couldn't sign in with ${provider === "apple" ? "Apple" : "Google"}. Try again, or sign in with your email and password.`,
      );
    } finally {
      setOauthLoading(null);
    }
  }

  const dark = resolvedMode === "dark";

  return (
    <AuthShell>
      <AuthHeading title="Sign in to Scoutable" />
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
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <GroupField
            ref={passwordRef}
            accessibilityLabel="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button onPress={handleSignIn} loading={submitting} disabled={!email.trim() || !password}>
          Sign in
        </Button>
        <Button variant="link" size="sm" onPress={() => router.push("/forgot-password")}>
          Forgot your password?
        </Button>
      </View>

      <AuthDivider />

      <View className="gap-2">
        {nativeApple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={6}
            style={{ height: 44 }}
            onPress={() => handleOAuth("apple")}
          />
        ) : (
          <Tappable
            accessibilityRole="button"
            onPress={() => handleOAuth("apple")}
            disabled={oauthLoading !== null}
            scaleTo={0.98}
            className="h-11 flex-row items-center justify-center gap-2 rounded-lg"
            style={{ backgroundColor: dark ? "#ffffff" : "#000000" }}
          >
            {oauthLoading === "apple" ? (
              <ActivityIndicator color={dark ? "#000000" : "#ffffff"} />
            ) : (
              <AppleLogo color={dark ? "#000000" : "#ffffff"} />
            )}
            <Text className="font-medium" style={{ color: dark ? "#000000" : "#ffffff" }}>
              Continue with Apple
            </Text>
          </Tappable>
        )}
        <Button
          variant="outline"
          onPress={() => handleOAuth("google")}
          loading={oauthLoading === "google"}
          icon={<GoogleLogo />}
        >
          Continue with Google
        </Button>
      </View>

      <AuthFootnote>
        <Text variant="callout" className="text-muted-foreground">
          New to Scoutable?
        </Text>
        <Text variant="callout" accessibilityRole="link" onPress={() => router.push("/sign-up")} className="font-medium text-primary">
          Create an account
        </Text>
      </AuthFootnote>
    </AuthShell>
  );
}
