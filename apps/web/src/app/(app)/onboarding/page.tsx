"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinByCode } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthError } from "@/components/auth/auth-frame";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { BackButton } from "@/components/shell/back-button";

function extractCode(input: string): string {
  const trimmed = input.trim();
  // Handle full URL or path like https://example.com/join/ABC123 or /join/ABC123
  const match = trimmed.match(/\/join\/([A-Za-z0-9]{4,10})(?:\?|#|\/|$)/);
  if (match) return match[1].toUpperCase();
  return trimmed.toUpperCase();
}

export default function OnboardingPage() {
  const router = useRouter();
  const { reloadProfile, setActiveOrg, myOrgs } = useAuth();
  // Without a space this is the only page there is (proxy.ts sends every
  // route here), so it carries its own way out; otherwise it's a step from
  // Get started, and signing out lives in the account menu and Profile.
  const hasSpace = myOrgs.length > 0;
  const [input, setInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    const code = extractCode(input);
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const res = await joinByCode(code);
      trackEvent(res.type === "team" ? "team_joined" : "org_joined", { via: "code" });
      toast.success("You've joined successfully!");
      // Activate the joined space BEFORE reloading — resolveActiveOrg
      // validates the stored id against the fresh org list, so the new org
      // sticks and /my-playlists doesn't bounce back to /get-started.
      setActiveOrg(res.orgId);
      await reloadProfile();
      router.push("/my-playlists");
    } catch (e) {
      setError((e as Error).message);
      setJoining(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Page width="narrow">
      <Toolbar title="Join a team" leading={hasSpace ? <BackButton href="/get-started" label="Get started" /> : undefined} />
      <PageContent>
        <div className="mx-auto grid max-w-sm gap-3 pt-2 lg:pt-6">
          <p className="text-sm text-muted-foreground">
            Enter your invite code, or paste the join link you were sent.
          </p>
          <Input
            aria-label="Invite code or join link"
            placeholder="ABC123 or app.scoutable.se/join/ABC123"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            autoFocus
          />
          <AuthError message={error} />
          <Button className="w-full" onClick={handleJoin} disabled={joining || !input.trim()}>
            {joining && <Loader2 className="animate-spin" />}
            Join
          </Button>
          {!hasSpace && (
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 justify-self-center text-callout text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          )}
        </div>
      </PageContent>
    </Page>
  );
}
