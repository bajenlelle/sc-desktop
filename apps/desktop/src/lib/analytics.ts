import posthog from 'posthog-js'
import type { AnalyticsEvent } from '@scoutable/shared/types/analytics'

export type { AnalyticsEvent }

export function initAnalytics() {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: false,
  })
  // Staging and prod share a PostHog project key; this super property is the
  // only way to tell their events apart.
  posthog.register({ environment: import.meta.env.VITE_ENV ?? 'development' })
}

export function identifyUser(userId: string, props: { email?: string; declared_role?: string }) {
  posthog.identify(userId, props)
}

export function resetUser() {
  posthog.reset()
}

/**
 * `instantly` sends the event on its own right away instead of with the next
 * batch (every few seconds): for an event the app may not outlive, like the
 * click that installs an update.
 */
export function trackEvent(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
  options?: { instantly?: boolean },
) {
  posthog.capture(event, properties, options?.instantly ? { send_instantly: true } : undefined)
}
