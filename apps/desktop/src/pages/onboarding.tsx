import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseInviteInput } from "@scoutable/shared/lib/orgs";
import { AuthError, AuthHeading, AuthShell, FieldGroup, GroupField } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { joinByCode } from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Joining a club by invite code. Reached deliberately (Profile › Join a
 * club), never forced: someone in no club still has their personal space and
 * belongs in the app, not behind this.
 */
export function OnboardingPage() {
  const { reloadProfile, setActiveOrg, myOrgs } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invites are handed out as links, so a pasted URL has to work here: see
  // parseInviteInput. Null means there is nothing worth sending yet.
  const code = parseInviteInput(input);
  // A short entry reads as a code: big, spaced figures. A pasted link doesn't.
  const looksLikeCode = input.length <= 8;

  async function handleJoin(e?: React.FormEvent) {
    e?.preventDefault();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const res = await joinByCode(code);
      toast.success("You joined the club");
      // Activate the joined space before reloading: resolveActiveOrg checks
      // the stored id against the fresh list, so without this a user with a
      // stale but valid stored club joins club B and lands in A.
      setActiveOrg(res.orgId);
      await reloadProfile();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeading title="Join a club" description="Paste your invite link, or type the code." />
      <form onSubmit={handleJoin} className="grid gap-3">
        <FieldGroup>
          <GroupField
            aria-label="Invite link or code"
            placeholder="ABC123 or an invite link"
            autoFocus
            spellCheck={false}
            autoCapitalize="characters"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            className={cn("h-12 text-center", looksLikeCode && input && "text-title-2 tracking-[0.2em] nums")}
          />
        </FieldGroup>
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={loading || !code}>
          {loading && <Loader2 className="animate-spin" />}
          Join
        </Button>
      </form>
      <p className="mt-4 text-center text-callout text-muted-foreground">Your coach or club admin can send you an invite.</p>
      {/* Someone who already has a space came here on purpose and needs a way
          back; a brand-new account has only Sign out. */}
      <div className="mt-6 flex justify-center">
        {myOrgs.length > 0 ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void createClient().auth.signOut()}>
            Sign out
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
