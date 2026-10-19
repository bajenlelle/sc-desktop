/**
 * Shown when the user is signed in but we could not read their account —
 * the profile row or get_my_orgs failed. Deliberately NOT the onboarding
 * page: a failed read says nothing about whether the user belongs to a club,
 * and asking a paying coach for an invite code because a request timed out is
 * how signed-in users used to get stranded here.
 */
import { useState } from "react";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function WorkspaceUnavailableScreen() {
  const { reloadProfile } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await reloadProfile();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <StatusScreen
      icon={<WifiOff />}
      title="Couldn't load your workspace"
      body="You're still signed in, and this is usually temporary. Try again, or sign out and back in."
      actions={
        <>
          <Button onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Try again
          </Button>
          <Button variant="ghost" onClick={() => void createClient().auth.signOut()}>
            Sign out
          </Button>
        </>
      }
    />
  );
}
