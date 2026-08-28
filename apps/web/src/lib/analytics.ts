/**
 * PostHog product analytics for the web app. Same project as desktop and
 * the landing page; events come from the shared vocabulary and carry an
 * `environment` super property (staging/prod share one key).
 *
 * Privacy model: anonymous visitors (public /h pages, signup, join) are
 * tracked with in-memory persistence only — no cookies or localStorage, so
 * the public pages need no consent banner. At sign-in we switch to
 * persistent storage (product analytics for account holders, as described
 * in the privacy policy).
 */
import posthog from "posthog-js";
import type { AnalyticsEvent } from "@scoutable/shared/types/analytics";

export type { AnalyticsEvent };

export function initAnalytics() {
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || posthog.__loaded) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    capture_pageview: false,
    capture_pageleave: false,
    person_profiles: "identified_only",
    persistence: "memory",
  });
  posthog.register({ environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development" });
}

/** Upgrade from cookieless anonymous mode once the user has an account. */
export function enablePersistentTracking() {
  if (!posthog.__loaded) return;
  posthog.set_config({ persistence: "localStorage+cookie" });
}

export function identifyUser(userId: string, props: Record<string, unknown>) {
  if (!posthog.__loaded) return;
  posthog.identify(userId, props);
}

/** Link the landing page's anonymous person (passed as ?ph_did=) to this user. */
export function aliasUser(previousDistinctId: string) {
  if (!posthog.__loaded) return;
  posthog.alias(previousDistinctId);
}

export function resetUser() {
  if (!posthog.__loaded) return;
  posthog.reset();
}

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  if (!posthog.__loaded) return;
  posthog.capture(event, properties);
}

const ATTRIB_KEY = "sc-attrib";

/**
 * Stash utm_* / ph_did / referrer from the arrival URL in sessionStorage so
 * they survive client-side navigation to the signup page.
 */
export function stashAttribution(searchParams: URLSearchParams) {
  if (typeof window === "undefined") return;
  const attrib: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) {
    if (k.startsWith("utm_") || k === "ph_did") attrib[k] = v;
  }
  if (document.referrer && !document.referrer.includes(window.location.hostname)) {
    attrib.referrer = document.referrer;
  }
  if (Object.keys(attrib).length === 0) return;
  // First touch wins — don't overwrite an earlier stash with a later hop.
  if (!sessionStorage.getItem(ATTRIB_KEY)) {
    sessionStorage.setItem(ATTRIB_KEY, JSON.stringify(attrib));
  }
}

export function getStashedAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(ATTRIB_KEY) ?? "{}");
  } catch {
    return {};
  }
}
