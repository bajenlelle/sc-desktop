"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinByCode } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";

function extractCode(input: string): string {
  const trimmed = input.trim();
  // Handle full URL or path like https://example.com/join/ABC123 or /join/ABC123
  const match = trimmed.match(/\/join\/([A-Za-z0-9]{4,10})(?:\?|#|\/|$)/);
  if (match) return match[1].toUpperCase();
  return trimmed.toUpperCase();
}

export default function OnboardingPage() {
  const router = useRouter();
  const { reloadProfile, setActiveOrg } = useAuth();
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
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-5">
          <div className="text-center space-y-1">
            <p className="text-lg font-semibold text-foreground">Welcome to Scoutable</p>
            <p className="text-sm text-muted-foreground">
              Enter your invite code or paste a join link to get started.
            </p>
          </div>

          <div className="space-y-2">
            <Input
              placeholder="ABC123 or app.scoutable.se/join/ABC123"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              autoFocus
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <Button
              className="w-full"
              onClick={handleJoin}
              disabled={joining || !input.trim()}
            >
              {joining ? "Joining…" : "Join"}
            </Button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Sign out
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
