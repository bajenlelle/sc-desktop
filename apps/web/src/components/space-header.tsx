import { Building2, User } from "lucide-react";
import type { OrgMembership } from "@scoutable/shared/types/org";
import type { ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { PlanBadge } from "@/components/plan-badge";
import { cn } from "@/lib/utils";

interface SpaceHeaderProps {
  /** The org whose space the user is currently in. */
  org: OrgMembership | null;
  /** True when this is the user's only space — hides the redundant label. */
  soloPersonal?: boolean;
  /** Import allowance; drives the quota form of the plan chip. */
  importQuota?: ImportQuota | null;
  className?: string;
}

/**
 * "You are here" indicator for the web navbar.
 *
 * Renders inline (single-line, horizontal) — icon + label + plan chip.
 * With only a personal space there's nothing to distinguish it from, so the
 * label is dropped and the plan chip stands alone.
 */
export function SpaceHeader({
  org,
  soloPersonal,
  importQuota,
  className,
}: SpaceHeaderProps) {
  if (!org) return null;
  const Icon = org.isPersonal ? User : Building2;
  const label = org.isPersonal ? "Personal" : org.orgName;

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {!soloPersonal && (
        <>
          <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span
            // min-w-0: a flex item's min-width defaults to its content, so
            // without it the name refuses to truncate below 128px and
            // overflows the navbar on narrow screens.
            className="min-w-0 truncate text-sm font-medium text-foreground max-w-[128px]"
            title={label}
          >
            {label}
          </span>
        </>
      )}
      <PlanBadge
        tier={org.planTier}
        size={soloPersonal ? "md" : "xs"}
        href={org.isPersonal ? "/profile" : undefined}
        quota={org.isPersonal ? importQuota : null}
      />
    </div>
  );
}
