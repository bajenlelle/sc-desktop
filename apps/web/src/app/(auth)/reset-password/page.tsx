"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, Loader2, Mail } from "lucide-react";
import { AuthError, AuthHeading, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type View = "choose" | "saved" | "request" | "sent";

/**
 * Every reset email links here with a one-time token_hash, whichever app
 * asked for it. The token is spent only when a new password is submitted,
 * so mail scanners that open links first can't use it up. Without a token
 * (or once it has expired) the page asks for an email and sends a new link.
 */
function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get("token_hash"));
  const [view, setView] = useState<View>(token ? "choose" : "request");
  const [expired, setExpired] = useState(false);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep the token out of the address bar and the history once it's read.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    if (!verified && token) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "recovery" });
      if (error) {
        setLoading(false);
        if (error.code === "otp_expired" || error.status === 403) {
          setExpired(true);
          setView("request");
        } else {
          setError(error.message);
        }
        return;
      }
      setVerified(true);
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setView("saved");
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setView("sent");
    setLoading(false);
  }

  if (view === "saved") {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
          <CircleCheck className="size-6" />
        </span>
        <h1 className="text-title-1">Password saved</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in with your new password in the Scoutable app, or continue here.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/my-playlists">Continue on the web</Link>
        </Button>
      </div>
    );
  }

  if (view === "sent") {
    return (
      <div className="text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Mail className="size-6" />
        </span>
        <h1 className="text-title-1">Check your inbox</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{email}</span> has an account, a link to choose a new password
          is on its way.
        </p>
        <p className="mt-6 text-callout">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  if (view === "request") {
    return (
      <>
        <AuthHeading
          title="Reset your password"
          description={
            expired
              ? "This link has expired or was already used. Enter your email to get a new one."
              : "We'll email you a link to choose a new one."
          }
        />
        <form onSubmit={sendLink} className="grid gap-3">
          <FieldGroup>
            <GroupField
              type="email"
              aria-label="Email"
              placeholder="Email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FieldGroup>
          <AuthError message={error} />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Send link
          </Button>
        </form>
        <p className="mt-6 text-center text-callout">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <form onSubmit={savePassword} className="grid gap-3">
        <FieldGroup>
          <GroupField
            type="password"
            aria-label="New password"
            placeholder="New password (at least 6 characters)"
            autoComplete="new-password"
            required
            minLength={6}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <GroupField
            type="password"
            aria-label="Confirm new password"
            placeholder="Confirm new password"
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
          Save password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
