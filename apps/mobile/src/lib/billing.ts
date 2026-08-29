/**
 * Mobile twin of web's lib/billing.ts openUpgradeFlow, minus the
 * billing-portal branch: the upgrade pitch only renders for free personal
 * orgs, so there's never an active subscription to manage from here.
 *
 * Android-only caller — iOS shows no purchase path (App Store 3.1.1).
 */
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { getDistinctId, trackEvent } from "./analytics";

const PRICING_URL_BASE = "https://scoutable.se/";

export async function openUpgradeFlow(email?: string | null): Promise<void> {
  trackEvent("upgrade_clicked", {
    source: "my_highlights",
    platform: Platform.OS,
    has_subscription: false,
  });

  // ph_did links this device's anonymous PostHog person back to the pricing
  // page's; params must precede the #pricing fragment.
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  const phDid = await getDistinctId();
  if (phDid) params.set("ph_did", phDid);
  const qs = params.toString();
  const url = qs ? `${PRICING_URL_BASE}?${qs}#pricing` : `${PRICING_URL_BASE}#pricing`;
  await WebBrowser.openBrowserAsync(url).catch(() => {});
}
