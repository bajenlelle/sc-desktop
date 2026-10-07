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
  // Your team (all apps). surface: step | profile
  | "team_step_shown" // role
  | "team_selected" // surface, league_id, team_name, suggested, spaces, includes_personal
  | "team_step_skipped"
  | "team_unlisted" // surface, spaces
  // Import funnel (desktop)
  | "game_synced"
  | "game_sync_failed"
  | "sync_point_skipped"
  | "demo_game_seeded"
  // Automatic tip-off detection (desktop import). Props in comments.
  // Tip-off flow (desktop). Every event carries surface (import | game_page). A suggestion's
  // source is a hint (stored by an earlier import of the recording) or auto (a fresh search).
  | "tipoff_hint_lookup" // hit, agreement, method, candidates
  | "tipoff_detect_started" // trigger, duration_s
  | "tipoff_detect_completed" // outcome, basis, confidence, seconds, elapsed_ms, api_calls, frames, view, user_activity (none = waited | seeked)
  | "tipoff_detect_failed" // error
  | "tipoff_detect_cancelled" // elapsed_ms, stage, reason (cancel_button | set_manually | left)
  | "tipoff_suggestion_accepted" // source, kind, seconds, method, agreement (was tipoff_hint_used in 0.6.17, hints only)
  | "tipoff_suggestion_dismissed" // source, kind, method, agreement (was tipoff_hint_rejected in 0.6.17, hints only)
  | "tipoff_suggestion_resolved" // path (lib/tipoff-analytics.ts), source, suggested_seconds, confirmed_seconds, delta_seconds, ms_since_link
  | "tipoff_hint_saved" // method
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
  | "playlist_ship_failed"
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
  // Push notifications (mobile)
  | "notification_prompt_shown"
  | "notification_permission_granted"
  | "notification_permission_denied"
  | "notification_opened"
  // Onboarding
  | "onboarding_step_clicked"
  | "onboarding_dismissed"
  | "onboarding_completed"
  // Player cross-space guidance (desktop club feed → personal space)
  | "player_welcome_cta"
  | "player_welcome_dismissed"
  | "player_feed_personal_space_link"
  // Clip browser
  | "clip_leaders_used" // player picked from the Leaders popover (props: metric)
  // Device registry & gate
  | "device_identity_migrated" // legacy random-uuid row collapsed into a hardware id
  | "device_gate_hit" // touch returned blocked (flag on)
  | "device_removed" // per-device Remove, from profile or the gate screen
  | "device_gate_resolved" // gate unblocked after removing a device
  | "device_gate_signed_out" // user bailed out of the gate via sign out
  // Monetization funnel
  | "upgrade_gate_hit"
  | "upgrade_clicked"
  | "plan_upgraded"
  | "subscription_started" // server-side (Stripe webhook)
  | "subscription_canceled" // server-side (Stripe webhook)
  | "checkout_started" // landing page
  | "download_clicked" // landing page + web My Highlights — always key it on
                       // `placement`; a second property shape (it was `source`
                       // here) lands every click in the "None" bucket of any
                       // placement breakdown, since all apps share one project
  // Org management & account
  | "team_created"
  | "member_removed"
  | "member_promoted"
  | "watermark_toggled"
  | "free_refill_granted" // /admin Free refills card; props: amount, emailed, forced
  | "color_theme_changed" // desktop/web/mobile Appearance surfaces; props: theme, mode
  | "account_delete_requested";
