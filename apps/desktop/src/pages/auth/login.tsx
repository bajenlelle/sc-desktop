import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthDivider, AuthError, AuthHeading, FieldGroup, GroupField, SocialSignIn } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    navigate("/");
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
            autoFocus
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
        <Link to="/auth/forgot-password" className="justify-self-center text-callout text-primary hover:underline">
          Forgot your password?
        </Link>
      </form>
      <AuthDivider />
      <SocialSignIn />
      <p className="mt-6 text-center text-callout text-muted-foreground">
        New to Scoutable?{" "}
        <Link to="/auth/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
