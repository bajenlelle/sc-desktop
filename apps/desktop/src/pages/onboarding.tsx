import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { joinByCode } from "@/lib/profile-db";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { reloadProfile } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      await joinByCode(code);
      await reloadProfile();
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Welcome to Scoutable</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your invite code to get started.
            </p>
          </div>
        </div>

        {/* Code input */}
        <div className="space-y-3">
          <Input
            placeholder="ABC123"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().slice(0, 6));
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            className="font-mono text-center text-lg tracking-widest h-12"
            maxLength={6}
            autoFocus
          />
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <Button
            className="w-full"
            disabled={loading || code.length !== 6}
            onClick={handleJoin}
          >
            {loading ? "Joining…" : "Join"}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Ask your coach or admin for an invite code.
        </p>

        <button
          onClick={() => createClient().auth.signOut()}
          className="mx-auto block text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
