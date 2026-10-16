"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupHeader, GroupedList } from "@/components/ui/group";
import { listOrgInvites, resendOrgInvite, revokeOrgInvite } from "@/lib/profile-db";
import { roleLabel } from "@/lib/roles";
import { relativeTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { canManageInvite, inviteExpiryLabel, pendingEmailInvites } from "@scoutable/shared/lib/pending-invites";
import type { OrgInvite, OrgTeam } from "@scoutable/shared/types/org";

const COLLAPSED_COUNT = 5;

/**
 * Emailed invites nobody has accepted yet, under the members. Refreshes on
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
        toast.success(`Invite to ${invite.email} withdrawn`);
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
    <section>
      <GroupHeader
        title={
          <>
            Pending invites <span className="font-normal text-muted-foreground nums">{invites.length}</span>
          </>
        }
        action={
          invites.length > COLLAPSED_COUNT && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${invites.length}`}
            </Button>
          )
        }
      />
      <GroupedList>
        {shown.map((invite) => {
          const expiry = inviteExpiryLabel(invite.expiresAt);
          const expired = expiry === "Expired";
          const team = teamName(invite.teamId);
          return (
            <div key={invite.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{invite.email}</span>
                <span className="truncate text-callout text-muted-foreground nums">
                  {[roleLabel(invite.role), team, `sent ${relativeTime(invite.createdAt)}`].filter(Boolean).join(" · ")}
                  {" · "}
                  <span className={cn(expired && "text-destructive")}>{expiry}</span>
                </span>
              </div>
              {canManageInvite(invite, isAdmin) &&
                (busyId === invite.id ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${invite.email}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void act(invite, "resend")}>Resend invite</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive focus:text-white"
                        onSelect={() => void act(invite, "revoke")}
                      >
                        Withdraw invite
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
            </div>
          );
        })}
      </GroupedList>
    </section>
  );
}
