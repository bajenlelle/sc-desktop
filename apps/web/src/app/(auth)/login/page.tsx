"use client";

export const dynamic = "force-dynamic";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthDivider, AuthError, AuthHeading, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { safeNext } from "@scoutable/shared/lib/safe-next";
import { DEFAULT_NEXT, withNext } from "@/lib/with-next";
import { pendingInvitePath } from "@/lib/pending-invite";

/** What an auth redirect wants the person to know before they sign in. */
const NOTICE_COPY: Record<string, string> = {
  confirmed: "Your email is confirmed. Sign in to continue.",
  link_used: "That link was already used or has expired. Sign in to continue, or sign up again for a new link.",
};

const ERROR_COPY: Record<string, string> = {
  auth_callback_error: "Couldn't finish signing in. Try again.",
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = safeNext(searchParams.get("next")) ?? DEFAULT_NEXT;
  const notice = NOTICE_COPY[searchParams.get("notice") ?? ""] ?? null;
  const urlError = ERROR_COPY[searchParams.get("error") ?? ""] ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // An invite the account signed up for, confirmed in another browser.
    router.push(nextParam === DEFAULT_NEXT ? (pendingInvitePath(data.user) ?? nextParam) : nextParam);
  }

  async function signInWithProvider(provider: "google" | "apple") {
    trackEvent("login_provider_clicked", { provider });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`,
      },
    });
    if (error) throw new Error(error.message);
  }

  return (
    <>
      <AuthHeading title="Sign in to Scoutable" description={notice ?? undefined} />
      <form onSubmit={handleSubmit} className="grid gap-3">
        <FieldGroup>
          <GroupField
            id="email"
            type="email"
            aria-label="Email"
            placeholder="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <GroupField
            id="password"
            type="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FieldGroup>
        <AuthError message={error ?? urlError} />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
        <Link href={withNext("/reset-password", nextParam)} className="justify-self-center text-callout text-primary hover:underline">
          Forgot your password?
        </Link>
      </form>
      <AuthDivider />
      <SocialSignIn onProvider={signInWithProvider} />
      <p className="mt-6 text-center text-callout text-muted-foreground">
        New to Scoutable?{" "}
        <Link href={withNext("/signup", nextParam)} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
