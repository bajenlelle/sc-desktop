import posthog from "posthog-js";
import { getSubscriptionStatus } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";

const PRICING_URL_BASE = "https://scoutable.se/";

/**
 * Opens the Stripe billing portal for the signed-in user (cookie auth).
 * Returns an error string on failure so callers can surface it however
 * suits them.
 */
export async function openBillingPortal(): Promise<string | null> {
  try {
    const res = await fetch("/api/billing-portal", { method: "POST" });
    const { url, error } = await res.json();
    if (error) return error as string;
    if (!url) return "Failed to open billing portal";
    window.location.href = url as string;
    return null;
  } catch {
    return "Failed to open billing portal";
  }
}

/**
 * The one entry point every web "upgrade" affordance should call — the
 * web twin of desktop's lib/billing.ts openUpgradeFlow.
 *
 * Existing subscribers go to the portal (Checkout would open a SECOND
 * subscription alongside their current one); everyone else gets the pricing
 * page in a new tab with their email pre-filled so the Stripe webhook can
 * match the customer back to this account.
 */
export async function openUpgradeFlow(
  email?: string | null,
  source: string = "billing_lib",
): Promise<string | null> {
  let hasActiveSub = false;
  try {
    hasActiveSub = !!(await getSubscriptionStatus())?.isActive;
  } catch {
    // Fall through to pricing — a failed lookup shouldn't dead-end the user.
  }

  trackEvent("upgrade_clicked", { source, has_subscription: hasActiveSub });

  if (hasActiveSub) return openBillingPortal();

  // ph_did links the pricing page's anonymous PostHog person back to this
  // account; params must precede the #pricing fragment.
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (posthog.__loaded) params.set("ph_did", posthog.get_distinct_id());
  const qs = params.toString();
  const url = qs ? `${PRICING_URL_BASE}?${qs}#pricing` : `${PRICING_URL_BASE}#pricing`;
  window.open(url, "_blank");
  return null;
}
