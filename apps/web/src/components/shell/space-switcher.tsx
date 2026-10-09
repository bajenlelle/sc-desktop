"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Check, ChevronDown, ChevronsUpDown, Settings, User } from "lucide-react";
import { toast } from "sonner";
import type { OrgMembership } from "@scoutable/shared/types/org";
import { orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { PlanBadge } from "@/components/plan-badge";
import { SpaceAvatar } from "@/components/space-avatar";
import { useAuth } from "@/components/auth-context";
import { useShell } from "./shell-context";
import { openUpgradeFlow } from "@/lib/billing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function orgLabel(org: OrgMembership): string {
  return org.isPersonal ? "Personal" : org.orgName;
}

/** What the switcher says under the space's name: the plan, or the imports left where they're capped. */
function planLine(org: OrgMembership, importQuota: ImportQuota | null): { text: string; warn: boolean; atCap: boolean } {
  // Quota only matters where imports are capped: personal spaces.
  const quota = org.isPersonal ? importQuota : null;
  if (quota == null || quota.limit == null || quota.remaining == null) {
    return { text: orgPlanLabel(org.planTier), warn: false, atCap: false };
  }
  const atCap = quota.remaining <= 0;
  // Small lifetime pools warn earlier, as PlanBadge does.
  const warn = !atCap && quota.used / quota.limit >= (quota.window === "lifetime" ? 0.65 : 0.8);
  return {
    text: atCap ? "Import limit reached" : `${quota.remaining} of ${quota.limit} imports left`,
    warn,
    atCap,
  };
}

/**
 * The space menu, shared by the sidebar's header and the narrow toolbar:
 * the spaces to switch between (personal first), club management for staff,
 * and the plan for the personal space.
 */
function SpaceMenuContent({ org, header }: { org: OrgMembership; header?: boolean }) {
  const { user, myOrgs, setActiveOrg, expectPlanChange } = useAuth();
  const { profile, importQuota } = useShell();
  const line = planLine(org, importQuota);

  const canSwitch = myOrgs.length > 1;
  const canManage = !org.isPersonal && (org.role === "coach" || org.role === "admin");
  // Personal first, then clubs by name.
  const sortedOrgs = [...myOrgs].sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
    return a.orgName.localeCompare(b.orgName);
  });
  // Subscribers manage their plan in Stripe's portal (openUpgradeFlow sends them there).
  const upgradeLabel = line.atCap
    ? "Upgrade to keep importing…"
    : org.planTier === "free" || org.planTier === "rookie"
      ? "Upgrade plan…"
      : "Manage subscription…";

  async function upgrade() {
    const err = await openUpgradeFlow(profile?.email ?? user?.email);
    if (err) toast.error(err);
    else expectPlanChange();
  }

  return (
    <>
      {header && (
        <>
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <SpaceAvatar name={org.orgName} personal={org.isPersonal} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{orgLabel(org)}</p>
              <p className={cn("truncate text-subheadline nums", line.atCap || line.warn ? "text-warning" : "text-muted-foreground")}>
                {line.text}
              </p>
            </div>
          </div>
          {(canSwitch || canManage || org.isPersonal) && <DropdownMenuSeparator />}
        </>
      )}
      {canSwitch && <DropdownMenuLabel>Spaces</DropdownMenuLabel>}
      {canSwitch &&
        sortedOrgs.map((o) => {
          const Icon = o.isPersonal ? User : Building2;
          return (
            <DropdownMenuItem key={o.orgId} onSelect={() => setActiveOrg(o.orgId)}>
              <Icon className="text-muted-foreground" />
              <span className="flex-1 truncate">{orgLabel(o)}</span>
              <PlanBadge tier={o.planTier} size="xs" />
              {o.orgId === org.orgId ? <Check className="size-3.5" /> : <span aria-hidden className="size-3.5" />}
            </DropdownMenuItem>
          );
        })}
      {canManage && (
        <>
          {canSwitch && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <Link href="/organization">
              <Settings className="text-muted-foreground" />
              <span className="flex-1 truncate">Manage {org.orgName}…</span>
            </Link>
          </DropdownMenuItem>
        </>
      )}
      {org.isPersonal && (
        <>
          {canSwitch && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => void upgrade()}>
            <ArrowUpRight className="text-muted-foreground" />
            <span className="flex-1">{upgradeLabel}</span>
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/**
 * The sidebar's header: which space you are in, on the plan you are on, with
 * the switcher, club management and the upgrade path one menu away.
 */
export function SpaceSwitcher({ org }: { org: OrgMembership }) {
  const { importQuota } = useShell();
  const line = planLine(org, importQuota);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2"
        >
          <SpaceAvatar name={org.orgName} personal={org.isPersonal} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{orgLabel(org)}</span>
            <span
              className={cn(
                "block truncate text-subheadline nums",
                line.atCap || line.warn ? "text-warning" : "text-muted-foreground",
              )}
            >
              {line.text}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64">
        <SpaceMenuContent org={org} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The narrow toolbar's space button: the space's badge on the left of the
 * bar, as iOS apps put the account. The menu repeats the name and plan the
 * sidebar would show.
 */
export function CompactSpaceSwitcher() {
  const { user, profileLoading, activeOrg, isPlayerOnly } = useAuth();
  // Player-only users navigate by content; spaces are a staff concept.
  if (!user || profileLoading || !activeOrg || isPlayerOnly) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Space: ${orgLabel(activeOrg)}`}
          className="-ml-1 flex h-11 items-center gap-1 rounded-lg px-1 outline-none transition-transform duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <SpaceAvatar name={activeOrg.orgName} personal={activeOrg.isPersonal} className="size-8 rounded-lg text-xs" />
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-72">
        <SpaceMenuContent org={activeOrg} header />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
