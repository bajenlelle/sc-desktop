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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-3">
            <WifiOff className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Couldn&rsquo;t load your workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&rsquo;re still signed in. This is usually a connection problem, so
            it&rsquo;s worth another try.
          </p>
        </div>

        <Button className="w-full gap-2" onClick={() => void handleRetry()} disabled={retrying}>
          {retrying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Try again
        </Button>

        <button
          onClick={() => createClient().auth.signOut()}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
