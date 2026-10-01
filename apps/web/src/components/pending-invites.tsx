"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listOrgInvites, resendOrgInvite, revokeOrgInvite } from "@/lib/profile-db";
import { relativeTimeShort } from "@scoutable/shared/lib/playlist-feed";
import { canManageInvite, inviteExpiryLabel, pendingEmailInvites } from "@scoutable/shared/lib/pending-invites";
import type { OrgInvite, OrgTeam } from "@scoutable/shared/types/org";

const COLLAPSED_COUNT = 5;

/**
 * Emailed invites nobody has accepted yet, on the Members tab. Refreshes on
 * org-setup-changed, which the invite dialog fires after every send.
 */
export function PendingInvites({
  orgId,
  orgTeams,
  isAdmin,
}: {
  orgId: string;
  orgTeams: OrgTeam[];
  isAdmin: boolean;
}) {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    listOrgInvites(orgId)
      .then((all) => setInvites(pendingEmailInvites(all)))
      .catch(() => setInvites([]));
  }, [orgId]);

  useEffect(() => {
    load();
    window.addEventListener("org-setup-changed", load);
    return () => window.removeEventListener("org-setup-changed", load);
  }, [load]);

  async function act(invite: OrgInvite, action: "resend" | "revoke") {
    setBusyId(invite.id);
    try {
      if (action === "resend") {
        await resendOrgInvite(invite.id);
        toast.success(`Invite resent to ${invite.email}`);
      } else {
        await revokeOrgInvite(invite.id);
        toast.success(`Invite to ${invite.email} revoked`);
      }
      window.dispatchEvent(new CustomEvent("org-setup-changed"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (invites.length === 0) return null;

  const shown = showAll ? invites : invites.slice(0, COLLAPSED_COUNT);
  const teamName = (id: string | null) => orgTeams.find((t) => t.id === id)?.name ?? null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        Pending invites ({invites.length})
      </p>
      {shown.map((invite) => {
        const expiry = inviteExpiryLabel(invite.expiresAt);
        const expired = expiry === "Expired";
        const team = teamName(invite.teamId);
        const busy = busyId === invite.id;
        return (
          <div
            key={invite.id}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm truncate">{invite.email}</p>
              <p className="text-xs text-muted-foreground truncate">
                {team ? `${team} · ` : ""}Sent {relativeTimeShort(invite.createdAt)} ·{" "}
                <span className={expired ? "text-destructive" : undefined}>{expiry}</span>
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Badge variant="outline" className="text-xs">{invite.role}</Badge>
              {canManageInvite(invite, isAdmin) &&
                (busy ? (
                  <Loader2 className="h-4 w-4 mx-1.5 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Resend invite"
                      onClick={() => act(invite, "resend")}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span className="sr-only">Resend invite to {invite.email}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Revoke invite"
                      onClick={() => act(invite, "revoke")}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Revoke invite to {invite.email}</span>
                    </Button>
                  </>
                ))}
            </div>
          </div>
        );
      })}
      {invites.length > COLLAPSED_COUNT && (
        <button
          type="button"
          className="px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${invites.length}`}
        </button>
      )}
    </div>
  );
}
