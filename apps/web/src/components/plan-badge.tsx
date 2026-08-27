import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { orgPlanColors, orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import type { OrgPlanTier } from "@scoutable/shared/types/org";
import { cn } from "@/lib/utils";

interface PlanBadgeProps {
  tier: OrgPlanTier;
  /** md = profile-card size (default). xs = chrome/dropdown size. */
  size?: "md" | "xs";
  /** When set, the badge renders as a Link and shows a subtle "↗" arrow. */
  href?: string;
  /**
   * Import allowance from useImportQuota(). Omit (or pass null) for
   * unlimited tiers or when unknown — the badge then shows the tier alone.
   * At ≥80% used the chip turns amber early warning; at zero remaining it
   * surfaces an explicit Upgrade prompt, since the cap is the thing actually
   * blocking the user.
   */
  quota?: ImportQuota | null;
  /**
   * One-click upgrade: when provided, clicking the chip goes straight to the
   * upgrade flow (pricing or billing portal) instead of `href` — in every
   * state, so the chip has one consistent meaning.
   */
  onUpgrade?: () => void;
  /**
   * Force the "↗" affordance — for badges wrapped in an external clickable
   * (e.g. the org switcher rows) that would otherwise look inert.
   */
  showArrow?: boolean;
  className?: string;
}

export function PlanBadge({ tier, size = "md", href, quota, onUpgrade, showArrow, className }: PlanBadgeProps) {
  const colors = orgPlanColors(tier);
  const label = orgPlanLabel(tier);

  const showQuota = quota != null && quota.limit != null && quota.remaining != null;
  const atCap = showQuota && quota.remaining! <= 0;
  const warn = showQuota && !atCap && quota.used / quota.limit! >= 0.8;
  const lifetime = showQuota && quota.window === "lifetime";

  const base = size === "xs"
    ? "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium leading-tight"
    : "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium";
  const dotSize = size === "xs" ? "h-1.5 w-1.5" : "h-2 w-2";
  const arrowSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  // Approaching or at the cap the whole chip goes amber — the tier colour
  // stops being the useful signal once imports are the constraint.
  const chipColors = atCap || warn
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-500"
    : colors.badge;
  const dotColor = atCap || warn ? "bg-amber-500" : colors.dot;

  const quotaText = !showQuota
    ? null
    : atCap
      ? "Limit reached — Upgrade"
      : `${quota.remaining} of ${quota.limit} imports left`;

  const title = !showQuota
    ? "Manage plan"
    : lifetime
      ? `${quota.remaining} of ${quota.limit} free game imports left — deleting doesn't restore them`
      : `${quota.remaining} of ${quota.limit} imports left this month · resets on the 1st`;

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
      {(href || showArrow || onUpgrade) && (
        <ArrowUpRight className={cn("flex-shrink-0", arrowSize)} aria-hidden />
      )}
    </>
  );

  const interactive =
    "cursor-pointer transition hover:brightness-110 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

  // An upgrade handler makes the chip THE plan entry point, always.
  if (onUpgrade) {
    return (
      <button type="button" onClick={onUpgrade} title={`${title} — upgrade`} className={cn(base, chipColors, interactive, className)}>
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} title={title} className={cn(base, chipColors, interactive, className)}>
        {content}
      </Link>
    );
  }

  return (
    <span title={showQuota ? title : undefined} className={cn(base, chipColors, className)}>{content}</span>
  );
}
