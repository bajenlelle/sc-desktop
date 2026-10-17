/**
 * Server-side PostHog capture for API routes (no posthog-node here: one
 * HTTP call per event is all the webhooks need). Same project key as the
 * browser; POSTHOG_KEY/POSTHOG_HOST override it server-side. Never throws:
 * analytics must not fail a webhook.
 */
export async function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const key = process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const configured = process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "";
  // A relative proxy path only works from the browser.
  const host = (configured.startsWith("http") ? configured : "https://eu.i.posthog.com").replace(/\/$/, "");
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: "scoutable-web-server" },
      }),
    });
  } catch (err) {
    console.error("[posthog-server] capture failed:", err);
  }
}
