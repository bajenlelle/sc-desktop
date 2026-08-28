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

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  posthog.capture(event, properties)
}
