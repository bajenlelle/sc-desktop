/**
 * PostHog for the stat keeper app — same EU project as the other surfaces
 * (split by `$lib`/host there), events from the shared vocabulary, an
 * `environment` super property, and an `app: "stats"` property so this app
 * can be told apart from the reader app. No autocapture. No-ops without
 * EXPO_PUBLIC_POSTHOG_KEY.
 */
import PostHog from "posthog-react-native";
import type { AnalyticsEvent } from "@scoutable/shared/types/analytics";

export type { AnalyticsEvent };

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const ENVIRONMENT = process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? "development" : "production");

let client: PostHog | null = null;

export function initAnalytics() {
  if (!KEY || client) return;
  client = new PostHog(KEY, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com" });
  client.register({ environment: ENVIRONMENT, app: "stats" });
}

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
