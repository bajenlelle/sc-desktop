import { useState } from "react";
import { ArrowUpRight, Building2, Check, ChevronsUpDown, Settings, ShoppingBag, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { OrgMembership } from "@scoutable/shared/types/org";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import { orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { PlanBadge } from "@/components/plan-badge";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";
import { usePlayerAccess } from "@/lib/player-access";
import { PurchaseSheet } from "@/components/purchase-sheet";
import { playerMeterLabel } from "@scoutable/shared/lib/player-access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function orgLabel(org: OrgMembership): string {
  return org.isPersonal ? "Personal" : org.orgName;
}

/**
 * The sidebar's header: which space you are in, on the plan you are on, with
 * the switcher, org management and the upgrade path one menu away. It
 * replaces both the old column of space tiles and the top strip.
 */
export function SpaceSwitcher({
  org,
  myOrgs,
  setActiveOrg,
  importQuota,
}: {
  org: OrgMembership;
  myOrgs: OrgMembership[];
  setActiveOrg: (orgId: string) => void;
  importQuota: ImportQuota | null;
}) {
  const { user, expectPlanChange } = useAuth();
  const navigate = useNavigate();
  const { access, playerMode } = usePlayerAccess();
  const [buyOpen, setBuyOpen] = useState(false);
  // Player passes: the personal space counts free, bought and season-pass games.
  const playerLine = org.isPersonal && playerMode && access ? playerMeterLabel(access) : null;
  const playerOut = playerLine === "No games left";

  const canSwitch = myOrgs.length > 1;
  const canManage = !org.isPersonal && (org.role === "coach" || org.role === "admin");
  const sortedOrgs = sortOrgsClubFirst(myOrgs);

  // Quota only matters where imports are capped: personal spaces.
  const quota = org.isPersonal ? importQuota : null;
  const showQuota = quota != null && quota.limit != null && quota.remaining != null;
  const atCap = showQuota && quota.remaining! <= 0;
  const lifetime = showQuota && quota.window === "lifetime";
  const warn = showQuota && !atCap && quota.used / quota.limit! >= (lifetime ? 0.65 : 0.8);
  const secondLine = playerLine
    ? playerLine
    : !showQuota
      ? orgPlanLabel(org.planTier)
      : atCap
        ? "Import limit reached"
        : `${quota.remaining} of ${quota.limit} imports left`;

  async function upgrade() {
    const err = await openUpgradeFlow(user?.email);
    if (err) toast.error(err);
    else expectPlanChange();
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2"
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
              org.isPersonal ? "bg-fill-2 text-muted-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {org.isPersonal ? <User className="size-4" /> : orgInitials(org.orgName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{orgLabel(org)}</span>
            <span
              className={cn(
                "block truncate text-subheadline nums",
                (playerLine ? playerOut : atCap || warn) ? "text-warning" : "text-muted-foreground",
              )}
            >
              {secondLine}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64">
        {canSwitch && <DropdownMenuLabel>Spaces</DropdownMenuLabel>}
        {sortedOrgs.map((o) => {
          const Icon = o.isPersonal ? User : Building2;
          const active = o.orgId === org.orgId;
          return (
            <DropdownMenuItem key={o.orgId} onSelect={() => setActiveOrg(o.orgId)}>
              <Icon className="text-muted-foreground" />
              <span className="flex-1 truncate">{orgLabel(o)}</span>
              <PlanBadge tier={o.planTier} size="xs" />
              {active && <Check className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {canManage && (
          <>
            {canSwitch && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => navigate("/organization")}>
              <Settings className="text-muted-foreground" />
              <span className="flex-1 truncate">Manage {org.orgName}…</span>
            </DropdownMenuItem>
          </>
        )}
        {org.isPersonal && (
          <>
            <DropdownMenuSeparator />
            {playerLine && (
              <DropdownMenuItem onSelect={() => setBuyOpen(true)}>
                <ShoppingBag className="text-muted-foreground" />
                <span className="flex-1">Buy games…</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void upgrade()}>
              <ArrowUpRight className="text-muted-foreground" />
              <span className="flex-1">
                {playerLine ? "Upgrade to Pro…" : atCap ? "Upgrade to keep importing…" : "Upgrade plan…"}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {playerLine && (
      <PurchaseSheet
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        title="Buy games"
        surface="profile"
        game={null}
        analyticsFeature="space_switcher"
      />
    )}
    </>
  );
}
