import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthError, AuthHeading, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    navigate("/");
  }

  return (
    <>
      <AuthHeading title="Choose a new password" />
      <form onSubmit={handleSubmit} className="grid gap-3">
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
