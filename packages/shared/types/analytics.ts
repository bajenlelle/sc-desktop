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
  // Your team (all apps). surface: step | profile | import
  | "team_step_shown" // role
  | "team_selected" // surface, league_id, team_name, suggested, spaces, includes_personal
  | "team_step_skipped"
  | "team_unlisted" // surface, spaces
  // Import funnel (desktop)
  | "game_synced" // …, picked_from (latest_card | team_list | all_list), team_game
  | "game_sync_failed"
  | "sync_point_skipped"
  | "shared_clips_recut" // game_id, clips, failed, hidden, playlists: a sync change re-cut (or hid) moved shared clips
  | "import_view_changed" // view (team | all)
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
  // Quarter-by-quarter sync, for a video that skips the breaks (desktop). surface: import | game_page | editor
  | "sync_cut_detected" // surface, overrun_s
  | "sync_cut_mode_toggled" // surface, on, detected
  | "period_sync_set" // surface, period, anchor_kind, predicted_delta_s
  | "period_sync_skipped" // surface, period
  | "period_sync_cleared" // surface, period (all = every quarter)
  | "sync_fix_opened" // entry (clip_menu | this_clip | banner)
  | "sync_fix_applied" // scope (quarter | play | game | clip), period, delta_s
  | "sync_fix_undone" // scope: the toast's Undo put the sync back
  | "sync_fix_peeked" // period: another quarter's play looked at inside Fix sync
  | "sync_cut_removed" // surface: a "From this play on" fix removed
  | "sync_hint_shown" // reason (past_end | looks_cut), clips
  | "sync_hint_dismissed" // reason
  | "sync_tip_shown" // the editor's one-time "Play a clip to check the timing" callout
  | "sync_tip_dismissed" // how (got_it | fix_sync)
  // Playlist production (desktop)
  | "playlist_created"
  | "clip_added_to_playlist"
  | "clip_trimmed" // desktop trim handles (props: playlist_id, in_changed, out_changed, length_seconds)
  | "playlist_filtered"
  | "clips_grouped"
  | "clips_ungrouped"
  | "text_card_inserted"
  | "stats_card_inserted"
  | "stats_card_suggestion_dismissed"
  // Scouting report (lib/scouting-report.ts, lib/report-draft.ts). origin: "web" from the web.
  | "scouting_report_opened" // players, clips, has_draft, shared
  | "scouting_report_players_picked" // players (in the report after), added, removed, with_clips, from_leaders, sorted_by
  | "scouting_report_clip_moved" // to (player | team | out | in: put back), clips, via (drag | keys | menu), reorder (stayed in its section)
  | "scouting_report_clip_played" // via (tile | panel), source (local | shared | none)
  | "scouting_report_section_removed" // had_note, clips, undone
  | "scouting_report_previewed" // players, clips (the share sheet opened)
  | "scouting_report_generated" // players, clips, shipped (clips cut for it), posters, regenerated, seconds, plan (the space's tier), limited (free tier: one live report)
  | "scouting_report_failed" // stage (ship | posters | publish), error
  | "scouting_report_cancelled" // stage
  | "scouting_report_link_copied" // method (button | qr)
  | "scouting_report_revoked" // via (sheet | limit | list)
  | "scouting_report_list_action" // action (open | copy | browser | stop | share_again | show_clips), status (live | expired | stopped | draft): a row's action on the Reports page
  | "scouting_report_limit_reached" // source (check | publish): the share sheet showed the one-report limit
  | "scouting_report_page_viewed" // valid, reason (not_found | expired | revoked) — fired by the public page
  | "scouting_report_pdf_saved" // fired by the public page's Save as PDF
  | "scouting_report_footer_clicked" // fired by the public page's "Made with Scoutable"
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
  | "app_download_clicked" // { surface: "join" | "banner" }: a player sent to /get-the-app
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
  | "clip_browser_opened" // the Add clips sheet opened; start (remembered | most_clips | newest), games_in_playlist
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
  // Player purchases (single games, one-time; the season pass is dormant since
  // 2026-10-23). The purchase sheet opening still fires upgrade_gate_hit so
  // the existing funnel continues.
  | "player_checkout_started" // props: kind, surface, own_team, trial_left, singles_left, role
  | "player_parent_link_shown" // "Pay with phone" QR/link opened
  | "player_purchase_seen" // the app noticed the paid purchase; props: kind
  | "season_pass_moved" // props: from_team, to_team
  | "player_purchase_completed" // server-side (apps/web player webhook); props: kind, quantity, amount, currency
  | "player_purchase_refunded" // server-side (apps/web player webhook)
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
  | "account_delete_requested"
  // Move content to a club (desktop Settings, web Profile; web sends origin: "web")
  | "content_move_opened" // clubs (how many clubs the user can move into)
  | "content_moved" // games, playlists, folders, auto_games, merged, second_copies, select_all, club_plan
  | "content_move_failed"; // error
