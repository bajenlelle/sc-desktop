/**
 * PostHog product analytics for the mobile app. Same EU project as web,
 * desktop and the landing page; events come from the shared vocabulary and
 * carry an `environment` super property (staging/prod share one key).
 *
 * No autocapture and no PostHogProvider — explicit tracking only, matching
 * the other apps' capture_pageview:false convention. Every helper no-ops
 * when EXPO_PUBLIC_POSTHOG_KEY is unset (local dev default).
 */
import PostHog from "posthog-react-native";
import type { AnalyticsEvent } from "@scoutable/shared/types/analytics";

export type { AnalyticsEvent };

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;

// Same shape as the Sentry environment above it in _layout.tsx; EAS build
// profiles set EXPO_PUBLIC_ENV (production / staging).
const ENVIRONMENT = process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? "development" : "production");

let client: PostHog | null = null;

export function initAnalytics() {
  if (!KEY || client) return;
  client = new PostHog(KEY, {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
  });
  client.register({ environment: ENVIRONMENT });
}

// PostHog's PostHogEventProperties rejects `unknown`, but the loose record
// keeps call sites identical to web/desktop (undefined values are dropped by
// the SDK at runtime).
type EventProps = Parameters<PostHog["capture"]>[1];

export function identifyUser(userId: string, props?: Record<string, unknown>) {
  client?.identify(userId, props as EventProps);
}

export function resetUser() {
  client?.reset();
}

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  client?.capture(event, properties as EventProps);
}

/**
 * For the ?ph_did= handoff to the pricing page — the landing site aliases
 * this device's anonymous person to the eventual Stripe customer. Async on
 * React Native, unlike posthog-js.
 */
export async function getDistinctId(): Promise<string | undefined> {
  return client ? await client.getDistinctId() : undefined;
}
