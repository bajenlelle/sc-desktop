import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { orgPlanColors, orgPlanLabel } from "@scoutable/shared/lib/plan-tier";
import type { OrgPlanTier } from "@scoutable/shared/types/org";
import { cn } from "@/lib/utils";

interface PlanBadgeProps {
  tier: OrgPlanTier;
  /** md = profile-card size (default). xs = chrome/dropdown size. */
  size?: "md" | "xs";
  /** When set, the badge renders as a Link and shows a subtle "↗" arrow. */
  href?: string;
  /**
   * Monthly imports still available. Omit (or pass null) for unlimited tiers
   * or when the count isn't known — the badge then shows the tier alone.
   * At zero the badge turns amber and surfaces an explicit Upgrade prompt,
   * since the cap is the thing actually blocking the user.
   */
  remaining?: number | null;
  className?: string;
}

export function PlanBadge({ tier, size = "md", href, remaining, className }: PlanBadgeProps) {
  const colors = orgPlanColors(tier);
  const label = orgPlanLabel(tier);

  const showQuota = remaining !== null && remaining !== undefined;
  const atCap = showQuota && remaining <= 0;

  const base = size === "xs"
    ? "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium leading-tight"
    : "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium";
  const dotSize = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  const arrowSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  // At the cap the whole chip goes amber — the tier colour stops being the
  // useful signal once the user can't import anything.
  const chipColors = atCap
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-500"
    : colors.badge;
  const dotColor = atCap ? "bg-amber-500" : colors.dot;

  const quotaText = !showQuota
    ? null
    : atCap
      ? "Limit reached — Upgrade"
      : `${remaining} import${remaining === 1 ? "" : "s"} left`;

  const content = (
    <>
      <span className={cn("rounded-full flex-shrink-0", dotSize, dotColor)} />
      {label}
      {quotaText && (
        <>
          <span aria-hidden className="opacity-40">·</span>
          <span>{quotaText}</span>
        </>
      )}
      {href && <ArrowUpRight className={cn("flex-shrink-0", arrowSize)} aria-hidden />}
    </>
  );

  if (href) {
    return (
      <Link
        to={href}
        title={atCap ? "Monthly import limit reached — manage plan" : "Manage plan"}
        className={cn(
          base,
          chipColors,
          "cursor-pointer transition hover:brightness-110 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
          className,
        )}
      >
        {content}
      </Link>
    );
  }

  return (
    <span className={cn(base, chipColors, className)}>{content}</span>
  );
}
