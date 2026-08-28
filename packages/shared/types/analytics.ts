/**
 * The shared product-analytics event vocabulary. Desktop and web fire into
 * one PostHog project (staging/prod split by an `environment` super
 * property), so event names must not fork between apps — add new events
 * here, never as app-local strings.
 *
 * Pure type, no runtime deps — analytics SDKs stay out of packages/shared
 * (same rule as error tracking, see scoutable/CLAUDE.md).
 */
export type AnalyticsEvent =
  // Lifecycle & identity
  | "app_started"
  | "signed_in"
  | "signed_up"
  | "signed_out"
  | "signup_provider_clicked"
  | "login_provider_clicked"
  | "declared_role_selected"
  | "page_viewed"
  // Import funnel (desktop)
  | "game_synced"
  | "game_sync_failed"
  | "sync_point_skipped"
  | "demo_game_seeded"
  // Playlist production (desktop)
  | "playlist_created"
  | "clip_added_to_playlist"
  | "playlist_filtered"
  | "clips_grouped"
  | "clips_ungrouped"
  | "text_card_inserted"
  | "folder_created"
  | "label_created"
  | "label_applied"
  // Distribution & virality
  | "video_exported"
  | "playlist_shipped"
  | "playlist_shared"
  | "highlight_sent_to_phone"
  | "highlight_page_viewed"
  | "highlight_saved"
  | "invite_link_viewed"
  | "invite_link_copied"
  | "invite_emails_sent"
  | "org_joined"
  | "team_joined"
  // Consumption & engagement (web + desktop players)
  | "playlist_opened"
  | "clip_watched"
  | "reminder_sent"
  // Onboarding
  | "onboarding_step_clicked"
  | "onboarding_dismissed"
  | "onboarding_completed"
  // Monetization funnel
  | "upgrade_gate_hit"
  | "upgrade_clicked"
  | "plan_upgraded"
  | "subscription_started" // server-side (Stripe webhook)
  | "subscription_canceled" // server-side (Stripe webhook)
  | "checkout_started" // landing page
  | "download_clicked" // landing page
  // Org management & account
  | "team_created"
  | "member_removed"
  | "member_promoted"
  | "watermark_toggled"
  | "account_delete_requested";
