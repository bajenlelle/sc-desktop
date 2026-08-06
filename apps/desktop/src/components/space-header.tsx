import { Building2, Check, ChevronDown, User } from "lucide-react";
import type { OrgMembership } from "@scoutable/shared/types/org";
import { PlanBadge } from "@/components/plan-badge";
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
export function SpaceHeader({ org, myOrgs, setActiveOrg, className }: SpaceHeaderProps) {
  if (!org) return null;
  const Icon = orgIcon(org.isPersonal);
  const label = orgLabel(org);

  const canSwitch = !!myOrgs && myOrgs.length > 1 && !!setActiveOrg;

  const sortedOrgs = canSwitch
    ? [...myOrgs!].sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
        return a.orgName.localeCompare(b.orgName);
      })
    : [];

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
      ) : (
        <>
          <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span
            className="truncate text-sm font-medium text-foreground max-w-[240px]"
            title={label}
          >
            {label}
          </span>
        </>
      )}
      <PlanBadge
        tier={org.planTier}
        size="xs"
        href={org.isPersonal ? "/profile" : undefined}
      />
    </div>
  );
}
