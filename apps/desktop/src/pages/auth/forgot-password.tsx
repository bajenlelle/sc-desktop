import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import { AuthError, AuthHeading, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: "scoutable://auth/callback?type=recovery",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
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
          <Link to="/auth/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Reset your password" description="We'll email you a link to choose a new one." />
      <form onSubmit={handleSubmit} className="grid gap-3">
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
        <Link to="/auth/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
