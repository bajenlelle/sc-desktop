import { useRef, useState } from "react";
import { View, type TextInput } from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { AuthError, AuthFootnote, AuthHeading, AuthShell, AuthStatus, FieldGroup, FieldRow, GroupField } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Text } from "@/components/ui/Text";

type DeclaredRole = "coach" | "player";

/** Back to the sign-in screen this was opened from, or to a fresh one. */
function backToSignIn() {
  if (router.canGoBack()) router.back();
  else router.replace("/sign-in");
}

const ROLE_HINT: Record<DeclaredRole, string> = {
  coach: "Scout opponents, cut clips and share playlists with your team.",
  player: "Study your games and build your own highlight tapes.",
};

export default function SignUp() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Mobile is the player app: the choice starts on "I play" (the web has no default).
  const [role, setRole] = useState<DeclaredRole>("player");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function handleSignUp() {
    if (!firstName.trim() || !email.trim() || !password || !confirm || submitting) return;
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
      <AuthShell>
        <AuthStatus title="Check your inbox">
            We sent a confirmation link to <Text variant="subheadline" className="font-semibold text-foreground">{email.trim()}</Text>. Open it to
            activate your account.
        </AuthStatus>
        <AuthFootnote>
          <Text variant="subheadline" className="text-muted-foreground">
            Already confirmed?
          </Text>
          <Text variant="subheadline" accessibilityRole="link" onPress={backToSignIn} className="font-semibold text-primary">
            Sign in
          </Text>
        </AuthFootnote>
      </AuthShell>
    );
  }

  const mismatch = confirm !== "" && confirm !== password;

  return (
    <AuthShell>
      <AuthHeading title="Create your account" />
      <View className="gap-3">
        <View className="gap-1.5">
          <SegmentedControl<DeclaredRole>
            fullWidth
            size="md"
            accessibilityLabel="I'm a"
            value={role}
            onValueChange={setRole}
            segments={[
              { value: "coach", label: "I coach" },
              { value: "player", label: "I play" },
            ]}
          />
          <Text variant="subheadline" className="px-1 text-center text-muted-foreground">
            {ROLE_HINT[role]}
          </Text>
        </View>
        <FieldGroup>
          <FieldRow>
            <GroupField
              accessibilityLabel="First name"
              placeholder="First name"
              value={firstName}
              onChangeText={setFirstName}
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => lastRef.current?.focus()}
            />
            <GroupField
              ref={lastRef}
              accessibilityLabel="Last name"
              placeholder="Last name"
              value={lastName}
              onChangeText={setLastName}
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
          </FieldRow>
          <GroupField
            ref={emailRef}
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
            placeholder="Password (at least 6 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <GroupField
            ref={confirmRef}
            accessibilityLabel="Confirm password"
            placeholder="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            invalid={mismatch}
            returnKeyType="go"
            onSubmitEditing={handleSignUp}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button onPress={handleSignUp} loading={submitting} disabled={!firstName.trim() || !email.trim() || !password || !confirm}>
          Create account
        </Button>
      </View>
      <AuthFootnote>
        <Text variant="subheadline" className="text-muted-foreground">
          Already have an account?
        </Text>
        <Text variant="subheadline" accessibilityRole="link" onPress={backToSignIn} className="font-semibold text-primary">
          Sign in
        </Text>
      </AuthFootnote>
    </AuthShell>
  );
}
