import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createClient } from "@/lib/supabase/client";
import { getSubscriptionStatus } from "@/lib/profile-db";

const PRICING_URL = "https://scoutable.se/";
const BILLING_PORTAL_URL = "https://app.scoutable.se/api/billing-portal";

/**
 * Opens the Stripe billing portal for the signed-in user.
 *
 * This is where an existing subscriber changes plans. Stripe swaps the
 * subscription in place and prorates it — no second customer, no second
 * subscription, no new trial.
 *
 * Returns an error string on failure so callers can surface it however
 * suits them (toast, inline, dialog).
 */
export async function openBillingPortal(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return "Not signed in";

    const res = await tauriFetch(BILLING_PORTAL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return "Failed to open billing portal";

    const { url, error } = await res.json();
    if (error) return error as string;
    if (!url) return "Failed to open billing portal";

    await openUrl(url as string);
    return null;
  } catch {
    return "Failed to open billing portal";
  }
}

/**
 * Opens the public pricing page to start a *new* subscription.
 *
 * The email is forwarded so Stripe Checkout can lock the address field to
 * the account's own email — the webhook matches the resulting customer back
 * to a Supabase user by email, so a typo there means a paid subscription
 * that never applies.
 *
 * Query params go before the fragment or the browser drops them.
 */
export async function openPricingPage(email?: string | null): Promise<void> {
  const url = email
    ? `${PRICING_URL}?email=${encodeURIComponent(email)}#pricing`
    : `${PRICING_URL}#pricing`;
  await openUrl(url);
}

/**
 * The one entry point every "upgrade" affordance should call.
 *
 * Sending an existing subscriber to Checkout creates a *second* subscription
 * alongside their current one — they get billed twice and the app only ever
 * tracks the newer of the two. So the destination is decided here from live
 * subscription state rather than by each call site, which makes that
 * mistake impossible to reintroduce.
 */
export async function openUpgradeFlow(email?: string | null): Promise<string | null> {
  let hasActiveSub = false;
  try {
    const sub = await getSubscriptionStatus();
    hasActiveSub = !!sub?.isActive;
  } catch {
    // Fall through to pricing — a failed lookup shouldn't dead-end the user.
  }

  if (hasActiveSub) return openBillingPortal();
  await openPricingPage(email);
  return null;
}
