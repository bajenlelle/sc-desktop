import Link from "next/link";
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
  className?: string;
}

export function PlanBadge({ tier, size = "md", href, className }: PlanBadgeProps) {
  const colors = orgPlanColors(tier);
  const label = orgPlanLabel(tier);

  const base = size === "xs"
    ? "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium leading-tight"
    : "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium";
  const dotSize = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  const arrowSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  const content = (
    <>
      <span className={cn("rounded-full flex-shrink-0", dotSize, colors.dot)} />
      {label}
      {href && <ArrowUpRight className={cn("flex-shrink-0", arrowSize)} aria-hidden />}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title="Manage plan"
        className={cn(
          base,
          colors.badge,
          "cursor-pointer transition hover:brightness-110 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
          className,
        )}
      >
        {content}
      </Link>
    );
  }

  return (
    <span className={cn(base, colors.badge, className)}>{content}</span>
  );
}
