import { Building2, Check, ChevronDown, User } from "lucide-react";
import { toast } from "sonner";
import type { OrgMembership } from "@scoutable/shared/types/org";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import type { ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { PlanBadge } from "@/components/plan-badge";
import { useAuth } from "@/lib/auth-context";
import { openUpgradeFlow } from "@/lib/billing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SpaceHeaderProps {
  /** The org whose space the user is currently in. */
  org: OrgMembership | null;
  /** All orgs the user belongs to. Enables the switcher dropdown when > 1. */
  myOrgs?: OrgMembership[];
  /** Called when the user picks a different org from the switcher menu. */
  setActiveOrg?: (orgId: string) => void;
  /** Import allowance; drives the quota form of the plan chip. */
  importQuota?: ImportQuota | null;
  className?: string;
}

function orgIcon(isPersonal: boolean) {
  return isPersonal ? User : Building2;
}

function orgLabel(org: OrgMembership): string {
  return org.isPersonal ? "Personal" : org.orgName;
}

/**
 * Topbar strip: "you are here" + plan.
 *
 * - Personal orgs render as "Personal" with a User icon.
 * - Team / franchise orgs render with their real name and a Building2 icon.
 * - When `myOrgs.length > 1`, the icon+name area becomes a switcher
 *   DropdownMenu trigger. The plan badge stays a separate sibling so it
 *   can independently link to /profile (see PlanBadge `href`).
 */
export function SpaceHeader({
  org,
  myOrgs,
  setActiveOrg,
  importQuota,
  className,
}: SpaceHeaderProps) {
  const { user, expectPlanChange } = useAuth();
  if (!org) return null;
  const Icon = orgIcon(org.isPersonal);
  const label = orgLabel(org);

  const canSwitch = !!myOrgs && myOrgs.length > 1 && !!setActiveOrg;

  // With only a personal space there's nothing to switch to and no other
  // space to distinguish it from — naming it "Personal" is noise. Show the
  // plan on its own instead.
  const soloPersonal = org.isPersonal && !canSwitch;

  // Club-first, personal last — the same order as the sidebar switcher
  // column, so the two switchers never disagree.
  const sortedOrgs = canSwitch ? sortOrgsClubFirst(myOrgs!) : [];

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-background/60 px-4 py-2 backdrop-blur",
        className,
      )}
    >
      {canSwitch ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1 -mx-2 -my-1 min-w-0 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span
                className="truncate text-sm font-medium text-foreground max-w-[240px]"
                title={label}
              >
                {label}
              </span>
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Spaces
            </div>
            {sortedOrgs.map((o) => {
              const OrgIcon = orgIcon(o.isPersonal);
              return (
                <DropdownMenuItem
                  key={o.orgId}
                  onSelect={() => setActiveOrg!(o.orgId)}
                  className="flex items-center gap-2"
                >
                  <OrgIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{orgLabel(o)}</span>
                  <PlanBadge tier={o.planTier} size="xs" />
                  {o.orgId === org.orgId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : !soloPersonal ? (
        <>
          <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span
            className="truncate text-sm font-medium text-foreground max-w-[240px]"
            title={label}
          >
            {label}
          </span>
        </>
      ) : null}
      <PlanBadge
        tier={org.planTier}
        // Standalone in an otherwise-empty bar, so it can afford to be legible.
        size={soloPersonal ? "md" : "xs"}
        href={org.isPersonal ? "/profile" : undefined}
        quota={org.isPersonal ? importQuota : null}
        // Warn/cap states skip /profile and go straight to pricing/portal —
        // the chip is the shortest path from "blocked" to "upgraded".
        onUpgrade={
          org.isPersonal
            ? async () => {
                const err = await openUpgradeFlow(user?.email);
                if (err) toast.error(err);
                else expectPlanChange();
              }
            : undefined
        }
      />
    </div>
  );
}
