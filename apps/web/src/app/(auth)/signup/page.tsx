"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { AuthDivider, AuthError, AuthHeading, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, getStashedAttribution } from "@/lib/analytics";

/**
 * Self-declared role: a copy and analytics signal only, never a permission
 * (membership roles govern access). Required so every email signup carries
 * it; OAuth signups get a one-click fallback on first run instead.
 */
type DeclaredRole = "coach" | "player";

const ROLE_HINT: Record<DeclaredRole, string> = {
  coach: "Scout opponents, cut clips and share playlists with your team.",
  player: "Study your games and build your own highlight tapes.",
};

export default function SignupPage() {
  const [declaredRole, setDeclaredRole] = useState<DeclaredRole | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!declaredRole) {
      setError("Choose whether you coach or play.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter your first and last name.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }

    setLoading(true);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/my-playlists";
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: `${firstName.trim()} ${lastName.trim()}`,
          declared_role: declaredRole,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    trackEvent("signed_up", { declared_role: declaredRole, ...getStashedAttribution() });
    setSuccess(true);
    setLoading(false);
  }

  async function signInWithProvider(provider: "google" | "apple") {
    trackEvent("signup_provider_clicked", { provider });
    const next = new URLSearchParams(window.location.search).get("next") ?? "/my-playlists";
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) throw new Error(error.message);
  }

  if (success) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Mail className="size-6" />
        </span>
        <h1 className="text-title-1">Check your inbox</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Open it to
          activate your account.
        </p>
        <p className="mt-6 text-callout text-muted-foreground">
          Already confirmed?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Create your account" />
      <form onSubmit={handleSubmit} className="grid gap-3">
        <div className="grid gap-1.5">
          <SegmentedControl
            size="md"
            aria-label="I'm a"
            className="w-full [&>*]:flex-1"
            value={(declaredRole ?? "") as DeclaredRole}
            onValueChange={setDeclaredRole}
            options={[
              { value: "coach", label: "I coach" },
              { value: "player", label: "I play" },
            ]}
          />
          <p className="min-h-4 px-1 text-center text-callout text-muted-foreground">
            {declaredRole ? ROLE_HINT[declaredRole] : "Pick one; you can do both later."}
          </p>
        </div>
        <FieldGroup>
          <div className="flex divide-x divide-separator">
            <GroupField
              aria-label="First name"
              placeholder="First name"
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <GroupField
              aria-label="Last name"
              placeholder="Last name"
              autoComplete="family-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <GroupField
            type="email"
            aria-label="Email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <GroupField
            type="password"
            aria-label="Password"
            placeholder="Password (at least 6 characters)"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <GroupField
            type="password"
            aria-label="Confirm password"
            placeholder="Confirm password"
            autoComplete="new-password"
            required
            aria-invalid={confirm !== "" && confirm !== password}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
      <AuthDivider />
      <SocialSignIn onProvider={signInWithProvider} />
      <p className="mt-6 text-center text-callout text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
