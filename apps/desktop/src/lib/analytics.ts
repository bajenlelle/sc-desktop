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

export function initAnalytics() {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: false,
  })
}

export function identifyUser(userId: string, props: { email?: string }) {
  posthog.identify(userId, props)
}

export function resetUser() {
  posthog.reset()
}

export function trackEvent(event: AnalyticsEvent, properties?: Record<string, unknown>) {
  posthog.capture(event, properties)
}
