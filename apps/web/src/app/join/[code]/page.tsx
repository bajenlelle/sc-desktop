"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { joinByCode } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { setStoredActiveOrg } from "@/components/auth-context";
import type { InviteInvalidReason } from "@scoutable/shared/types/org";
import { toast } from "sonner";

const INVALID_COPY: Record<InviteInvalidReason, { title: string; body: string }> = {
  expired_license: {
    title: "Organisation license expired",
    body: "This invite belongs to an organisation whose license has expired. Ask the organisation's admin to renew before joining.",
  },
  expired_invite: {
    title: "Invite link expired",
    body: "This invite link has expired. Ask your admin for a new one.",
  },
  exhausted: {
    title: "Invite link no longer available",
    body: "This invite link has reached its usage limit. Ask your admin for a new one.",
  },
  not_found: {
    title: "Invalid invite",
    body: "This invite link is not recognised. Double-check the URL or ask for a new one.",
  },
};

async function signOutAndRedirect(redirectTo: string) {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = redirectTo;
}

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();

  const [preview, setPreview] = useState<{
    valid: boolean;
    reason?: InviteInvalidReason;
    orgName?: string;
    teamName?: string | null;
    role?: string;
    email?: string | null;
  } | null>(null);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [userEmail, setUserEmail] = useState<string | null | undefined>(undefined);
  const [userCreatedAt, setUserCreatedAt] = useState<string | null>(null);
  const [mismatchConfirmed, setMismatchConfirmed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState<{
    type: "org" | "team" | "secondary_org";
    orgId: string;
    teamId?: string;
  } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      Promise.resolve(supabase.rpc("get_invite_preview", { p_code: code.toUpperCase() })).then(({ data }) => {
        const r = data as { valid: boolean; reason?: string; org_name?: string; team_name?: string | null; role?: string; email?: string | null } | null;
        if (!r) {
          setPreview({ valid: false, reason: 'not_found' });
          trackEvent("invite_link_viewed", { valid: false, reason: "not_found" });
          return;
        }
        trackEvent("invite_link_viewed", { valid: r.valid, ...(r.valid ? {} : { reason: r.reason ?? "not_found" }) });
        setPreview({
          valid: r.valid,
          reason: r.reason as InviteInvalidReason | undefined,
          orgName: r.org_name,
          teamName: r.team_name,
          role: r.role,
          email: r.email ?? null,
        });
      }).catch(() => setLoadError("Failed to load invite details.")),
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
        setUserEmail(user?.email ?? null);
        setUserCreatedAt(user?.created_at ?? null);
      }),
    ]);
  }, [code]);

  const emailMismatch =
    !!preview?.email &&
    userEmail !== null &&
    userEmail !== undefined &&
    preview.email.toLowerCase() !== userEmail.toLowerCase();

  const isNewAccount =
    !!userCreatedAt &&
    Date.now() - new Date(userCreatedAt).getTime() < 5 * 60 * 1000;

  useEffect(() => {
    if (userId && preview?.valid && !joining && !joinResult && (!emailMismatch || mismatchConfirmed)) {
      setJoining(true);
      joinByCode(code)
        .then((result) => {
          setJoining(false);
          trackEvent(result.type === "team" ? "team_joined" : "org_joined", { via: "link" });
          // Make the joined org the active space — otherwise the user lands
          // back in their personal space and never sees what they joined.
          // (This page is outside AuthProvider, so write the stored choice
          // directly; the reload / next mount picks it up.)
          setStoredActiveOrg(result.orgId);
          if (result.type === "org" || result.type === "secondary_org") {
            toast.success(`You joined ${preview.orgName ?? "the organization"}!`);
            window.location.href = "/my-playlists";
          } else {
            setJoinResult(result);
          }
        })
        .catch((e) => {
          setJoining(false);
          setJoinError((e as Error).message);
        });
    }
  }, [userId, preview, mismatchConfirmed]);

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

  if (preview === null || userId === undefined || userEmail === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
            <Button asChild variant="outline" className="w-full" size="sm">
              <Link href="/">Go home</Link>
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
    const copy = INVALID_COPY[preview.reason ?? 'not_found'];
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center space-y-3">
            <p className="font-semibold text-foreground">{copy.title}</p>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
            <Link href="/" className="text-sm text-primary underline">Go home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (userId !== null && emailMismatch && !mismatchConfirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 space-y-4">
            <div className="text-center space-y-1">
              <p className="font-semibold text-foreground">Account mismatch</p>
              <p className="text-sm text-muted-foreground">
                This invite was sent to{" "}
                <span className="font-medium text-foreground">{preview.email}</span>.
              </p>
              <p className="text-sm text-muted-foreground">
                You&apos;re signed in as{" "}
                <span className="font-medium text-foreground">{userEmail}</span>.
              </p>
            </div>
            <div className="space-y-2">
              <Button className="w-full" size="sm" onClick={() => setMismatchConfirmed(true)}>
                Accept as {userEmail}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                size="sm"
                onClick={() => signOutAndRedirect(`/login?next=/join/${code}`)}
              >
                Sign in with another account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (joinResult) {
    const destination = preview.teamName
      ? `${preview.orgName} — ${preview.teamName}`
      : preview.orgName ?? "the organization";

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 space-y-4">
            <div className="text-center space-y-1">
              <p className="text-lg font-semibold text-foreground">
                {isNewAccount ? "Welcome to Scoutable!" : "You're in!"}
              </p>
              <p className="text-sm text-muted-foreground">
                You&apos;ve been added to{" "}
                <span className="font-medium text-foreground">{destination}</span>
                {preview.role && (
                  <> as <Badge variant={roleBadgeVariant(preview.role)} className="text-xs ml-0.5">{preview.role}</Badge></>
                )}
                .
              </p>
            </div>
            <div className="space-y-2">
              <Button className="w-full" size="sm" onClick={() => { window.location.href = "/organization"; }}>
                Go to organization
              </Button>
              <Button asChild variant="outline" className="w-full" size="sm">
                <Link href="/my-playlists">Go to my playlists</Link>
              </Button>
            </div>
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
