"use client";

import { ChevronsUpDown, Lock } from "lucide-react";
import type { OrgPlanTier } from "@scoutable/shared/types/org";
import { orgPlanLabel } from "@scoutable/shared/lib/plan-tier";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

const TIERS: OrgPlanTier[] = ["free", "rookie", "pro", "franchise"];

/**
 * An organization's plan as a pop-up button. A tier chosen here is set by
 * hand, and the Stripe webhook leaves it alone: the lock shows on the button,
 * and the menu offers to hand the plan back to Stripe.
 */
export function PlanTierMenu({
  value,
  lockedAt,
  onChange,
  onUnlock,
  className,
}: {
  value: OrgPlanTier;
  lockedAt?: string | null;
  onChange: (tier: OrgPlanTier) => void;
  onUnlock?: () => void;
  className?: string;
}) {
  const label = orgPlanLabel(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Plan: ${label}${lockedAt ? ", set by hand" : ""}`}
          title={lockedAt ? `Set by hand ${formatDate(lockedAt)}: Stripe won't change it` : undefined}
          className={cn(
            "inline-flex h-6 min-w-0 items-center gap-1 rounded-md bg-card pr-1 pl-2 text-callout text-foreground shadow-xs ring-1 ring-separator outline-none",
            "transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection",
            "pointer-coarse:h-8 pointer-coarse:pl-2.5",
            className,
          )}
        >
          {lockedAt && <Lock className="size-3 shrink-0 text-warning" aria-hidden />}
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => v !== value && onChange(v as OrgPlanTier)}>
          {TIERS.map((t) => (
            <DropdownMenuRadioItem key={t} value={t}>
              {orgPlanLabel(t)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {lockedAt && onUnlock && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUnlock}>
              <span className="flex flex-col">
                <span>Let Stripe manage the plan</span>
                <span className="text-callout opacity-70">Set by hand {formatDate(lockedAt)}</span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
