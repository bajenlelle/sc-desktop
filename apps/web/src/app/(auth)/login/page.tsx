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

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next") ?? "/my-playlists";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next") ?? "/my-playlists";
    router.push(next);
  }

  async function signInWithProvider(provider: "google" | "apple") {
    trackEvent("login_provider_clicked", { provider });
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

  return (
    <>
      <AuthHeading title="Sign in to Scoutable" />
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
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
      <AuthDivider />
      <SocialSignIn onProvider={signInWithProvider} />
      <p className="mt-6 text-center text-callout text-muted-foreground">
        New to Scoutable?{" "}
        <Link href={"/signup?next=" + encodeURIComponent(nextParam)} className="font-medium text-primary hover:underline">
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
