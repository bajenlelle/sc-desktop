import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { joinByCode } from "@/lib/profile-db";
import { parseInviteInput } from "@scoutable/shared/lib/orgs";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

/**
 * Joining a club by invite code. Reached deliberately (space menu → Join a
 * club), never forced: a user who belongs to no club still has their personal
 * space and belongs in the app, not behind this.
 */
export function OnboardingPage() {
  const { reloadProfile, setActiveOrg, myOrgs } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invites are handed out as links, so a pasted URL has to work here — see
  // parseInviteInput. Null means there is nothing worth sending yet.
  const code = parseInviteInput(input);

  async function handleJoin() {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const res = await joinByCode(code);
      toast.success("You've joined successfully!");
      // Activate the joined space BEFORE reloading — resolveActiveOrg
      // validates the stored id against the fresh list, so without this a
      // user with a stale-but-valid stored org joins club B and lands in A.
      setActiveOrg(res.orgId);
      await reloadProfile();
      navigate("/");
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
          <LogoMark className="h-14 w-14 rounded-xl" />
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Join a club</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste your invite link, or enter the code.
            </p>
          </div>
        </div>

        {/* Code input */}
        <div className="space-y-3">
          <Input
            placeholder="ABC123 or invite link"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            // A pasted link is long, so only style it like a code field while
            // it still looks like one.
            className={
              input.length <= 6
                ? "font-mono text-center text-lg tracking-widest h-12"
                : "text-center text-sm h-12"
            }
            autoFocus
          />
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <Button
            className="w-full"
            disabled={loading || !code}
            onClick={handleJoin}
          >
            {loading ? "Joining…" : "Join"}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Ask your coach or admin for an invite link.
        </p>

        {/* Someone who already has a space came here on purpose and needs a
            way back; a brand-new account has only sign-out. */}
        {myOrgs.length > 0 ? (
          <button
            onClick={() => navigate(-1)}
            className="mx-auto block text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => createClient().auth.signOut()}
            className="mx-auto block text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
