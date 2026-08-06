import { Building2, User } from "lucide-react";
import type { OrgMembership } from "@scoutable/shared/types/org";
import { PlanBadge } from "@/components/plan-badge";
import { cn } from "@/lib/utils";

interface SpaceHeaderProps {
  /** The org whose space the user is currently in. */
  org: OrgMembership | null;
  className?: string;
}

/**
 * "You are here" strip rendered at the top of every page.
 *
 * - Personal orgs render as "Personal" with a User icon (regardless of the
 *   stored orgName).
 * - Team / franchise orgs render with their real name and a Building2 icon.
 * - Plan chip alongside so subscribers see their tier at all times.
 */
export function SpaceHeader({ org, className }: SpaceHeaderProps) {
  if (!org) return null;
  const Icon = org.isPersonal ? User : Building2;
  const label = org.isPersonal ? "Personal" : org.orgName;

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-background/60 px-4 py-2 backdrop-blur",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span
        className="truncate text-sm font-medium text-foreground max-w-[240px]"
        title={label}
      >
        {label}
      </span>
      <PlanBadge
        tier={org.planTier}
        size="xs"
        href={org.isPersonal ? "/profile" : undefined}
      />
    </div>
  );
}
