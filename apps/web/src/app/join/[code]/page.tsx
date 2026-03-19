"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { joinByCode } from "@/lib/profile-db";

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [preview, setPreview] = useState<{
    valid: boolean;
    orgName?: string;
    teamName?: string | null;
    role?: string;
  } | null>(null);
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.rpc("get_invite_preview", { p_code: code.toUpperCase() }).then(({ data }) => {
        const r = data as { valid: boolean; org_name?: string; team_name?: string | null; role?: string } | null;
        if (!r) { setPreview({ valid: false }); return; }
        setPreview({ valid: r.valid, orgName: r.org_name, teamName: r.team_name, role: r.role });
      }).catch(() => setLoadError("Failed to load invite details.")),
      supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null)),
    ]);
  }, [code]);

  useEffect(() => {
    if (userId && preview?.valid && !joining) {
      setJoining(true);
      joinByCode(code)
        .then(() => router.push("/my-playlists"))
        .catch((e) => {
          setJoining(false);
          setJoinError((e as Error).message);
        });
    }
  }, [userId, preview]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-red-500">{loadError}</p>
            <Link href="/" className="text-sm text-primary underline">Go home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (preview === null || userId === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-semibold text-foreground">Unable to join</p>
            <p className="text-sm text-muted-foreground">{joinError}</p>
            <Button asChild className="w-full" size="sm">
              <Link href="/onboarding">Continue to onboarding</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joining) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Joining…</p>
      </div>
    );
  }

  if (!preview.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-semibold text-foreground">Invalid or expired invite</p>
            <p className="text-sm text-muted-foreground">
              This invite link is no longer valid. Ask your admin to generate a new one.
            </p>
            <Link href="/" className="text-sm text-primary underline">Go home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const destination = preview.teamName
    ? `${preview.orgName} — ${preview.teamName}`
    : preview.orgName ?? "an organization";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-4">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-foreground">You&apos;re invited!</p>
            <p className="text-sm text-muted-foreground">
              Join <span className="font-medium text-foreground">{destination}</span> as{" "}
              {preview.role && (
                <Badge variant={roleBadgeVariant(preview.role)} className="text-xs ml-0.5">
                  {preview.role}
                </Badge>
              )}
            </p>
          </div>

          {userId === null && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">Sign up or log in to join.</p>
              <div className="flex gap-2">
                <Button asChild className="flex-1" size="sm">
                  <Link href={`/signup?next=/join/${code}`}>Sign up</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1" size="sm">
                  <Link href={`/login?next=/join/${code}`}>Log in</Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
