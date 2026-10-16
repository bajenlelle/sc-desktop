"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AuthHeading, AuthShell } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { roleLabel } from "@/lib/roles";
import { joinByCode } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { setStoredActiveOrg } from "@/components/auth-context";
import type { InviteInvalidReason } from "@scoutable/shared/types/org";
import { toast } from "sonner";

const INVALID_COPY: Record<InviteInvalidReason, { title: string; body: string }> = {
  expired_license: {
    title: "Organization license expired",
    body: "This invite belongs to an organization whose license has expired. The organization can request a renewal from Scoutable — new members can join once it's renewed.",
  },
  expired_invite: {
    title: "Invite link expired",
    body: "This invite link has expired. Ask your admin for a new one.",
  },
  exhausted: {
    title: "Invite link no longer available",
    body: "This invite link has reached its usage limit. Ask your admin for a new one.",
  },
  seat_limit_reached: {
    title: "No seats left",
    body: "This organization has used all its seats for this role. The organization admin has been notified — ask them to free a seat or add more.",
  },
  not_found: {
    title: "Invalid invite",
    body: "This invite link is not recognized. Double-check the URL or ask for a new one.",
  },
};

async function signOutAndRedirect(redirectTo: string) {
  const supabase = createClient();
  // Local scope: switching accounts here shouldn't kick the user's other devices.
  await supabase.auth.signOut({ scope: "local" });
  window.location.href = redirectTo;
}

/** "a coach", "an admin": the role as the sentence says it. */
function asRole(role: string): string {
  const label = roleLabel(role).toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
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

  // join_by_code binds emailed admin/coach invites to their address
  // (invite_email_mismatch), so for those a mismatch can't be accepted anyway.
  const mismatchBlocks =
    emailMismatch && (preview?.role === "admin" || preview?.role === "coach");

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
            // Admins land where their setup work happens (teams, invites);
            // everyone else lands on the playlists they came for.
            window.location.href =
              preview.role === "admin" ? "/organization" : "/my-playlists";
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
      <AuthShell>
        <AuthHeading title="Couldn't load the invite" description={loadError} />
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go home</Link>
        </Button>
      </AuthShell>
    );
  }

  if (preview === null || userId === undefined || userEmail === undefined || joining) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 text-callout text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {joining && "Joining…"}
        </div>
      </AuthShell>
    );
  }

  if (joinError) {
    return (
      <AuthShell>
        <AuthHeading title="Couldn't join" description={joinError} />
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go home</Link>
        </Button>
      </AuthShell>
    );
  }

  if (!preview.valid) {
    const copy = INVALID_COPY[preview.reason ?? 'not_found'];
    return (
      <AuthShell>
        <AuthHeading title={copy.title} description={copy.body} />
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Go home</Link>
        </Button>
      </AuthShell>
    );
  }

  if (userId !== null && emailMismatch && !mismatchConfirmed) {
    return (
      <AuthShell>
        <AuthHeading
          title="This invite is for another account"
          description={
            <>
              It was sent to <span className="font-medium text-foreground">{preview.email}</span>, and you&apos;re
              signed in as <span className="font-medium text-foreground">{userEmail}</span>.
              {mismatchBlocks && (
                <> {preview.role === "admin" ? "Admin" : "Coach"} invites only work for the address they were sent to.</>
              )}
            </>
          }
        />
        <div className="grid gap-2">
          {!mismatchBlocks && (
            <Button className="w-full" onClick={() => setMismatchConfirmed(true)}>
              Accept as {userEmail}
            </Button>
          )}
          <Button
            variant={mismatchBlocks ? "default" : "outline"}
            className="w-full"
            onClick={() => signOutAndRedirect(`/login?next=/join/${code}`)}
          >
            Sign in with another account
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (joinResult) {
    const destination = preview.teamName
      ? `${preview.orgName} — ${preview.teamName}`
      : preview.orgName ?? "the club";

    return (
      <AuthShell>
        <AuthHeading
          title={isNewAccount ? "Welcome to Scoutable" : "You're in"}
          description={
            <>
              You&apos;ve been added to <span className="font-medium text-foreground">{destination}</span>
              {preview.role && <> as {asRole(preview.role)}</>}.
            </>
          }
        />
        <div className="grid gap-2">
          <Button className="w-full" onClick={() => { window.location.href = "/organization"; }}>
            Go to your club
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/my-playlists">Go to my playlists</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const destination = preview.teamName
    ? `${preview.orgName} — ${preview.teamName}`
    : preview.orgName ?? "a club";

  return (
    <AuthShell>
      <AuthHeading
        title="You're invited"
        description={
          <>
            Join <span className="font-medium text-foreground">{destination}</span>
            {preview.role && <> as {asRole(preview.role)}</>}.
          </>
        }
      />
      {userId === null && (
        <div className="grid gap-2">
          <Button asChild className="w-full">
            <Link href={`/signup?next=/join/${code}`}>Create an account</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/login?next=/join/${code}`}>Sign in</Link>
          </Button>
          <p className="mt-1 text-center text-callout text-muted-foreground">Sign in or create an account to join.</p>
        </div>
      )}
    </AuthShell>
  );
}
