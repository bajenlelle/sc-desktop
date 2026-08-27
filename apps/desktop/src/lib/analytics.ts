import posthog from 'posthog-js'

export type AnalyticsEvent =
  | 'app_started'
  | 'signed_in'
  | 'signed_up'
  | 'signed_out'
  | 'game_synced'
  | 'playlist_created'
  | 'video_exported'
  | 'page_viewed'
  | 'clip_added_to_playlist'
  | 'playlist_shipped'
  | 'playlist_filtered'
  | 'clips_grouped'
  | 'highlight_sent_to_phone'
  | 'demo_game_seeded'
  | 'onboarding_step_clicked'
  | 'onboarding_dismissed'
  | 'onboarding_completed'

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
