import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase/client";
import { getSubscriptionStatus } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";

const PRICING_URL = "https://scoutable.se/pricing";
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
 */
export async function openPricingPage(email?: string | null): Promise<void> {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  // Forward the PostHog distinct id so the landing page can stitch this
  // anonymous visit to the desktop user's analytics identity.
  if (posthog.__loaded) params.set("ph_did", posthog.get_distinct_id());
  const query = params.toString();
  const url = query ? `${PRICING_URL}?${query}` : PRICING_URL;
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

  if (hasActiveSub) {
    trackEvent("upgrade_clicked", { source: "billing_lib", has_subscription: true });
    return openBillingPortal();
  }
  await openPricingPage(email);
  return null;
}

const PLAYER_CHECKOUT_URL = "https://app.scoutable.se/api/player-checkout";

export type PlayerCheckoutKind = "single_game" | "season_pass";

// The checkout route's error tokens, in words.
const CHECKOUT_ERRORS: Record<string, string> = {
  sales_closed: "Buying games isn't open yet.",
  no_team: "Set your team before buying the season pass.",
  team_not_in_season: "Your team has no games this season, so there's no season pass for it.",
  already_have_pass: "You already have the season pass for this team.",
  price_not_configured: "Buying games is unavailable right now. Try again later.",
  checkout_failed: "The payment page didn't open. Try again.",
  unauthorized: "Sign in again to buy.",
};

/**
 * Creates a one-time Checkout for a single game or the season pass and
 * returns its URL (valid 24 hours, payable on any device, so a parent can
 * pay it on their phone). The caller opens it and waits for the purchase.
 */
export async function startPlayerCheckout(opts: {
  kind: PlayerCheckoutKind;
  gameKey?: string | null;
  surface: string;
}): Promise<{ url: string } | { error: string }> {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: CHECKOUT_ERRORS.unauthorized };
    const lang = navigator.language?.toLowerCase().startsWith("sv") ? "sv" : "en";
    const res = await tauriFetch(PLAYER_CHECKOUT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: opts.kind, game_key: opts.gameKey ?? undefined, surface: opts.surface, lang }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) {
      return { error: (body.error && CHECKOUT_ERRORS[body.error]) || CHECKOUT_ERRORS.checkout_failed };
    }
    await openUrl(body.url);
    return { url: body.url };
  } catch {
    return { error: CHECKOUT_ERRORS.checkout_failed };
  }
}
