-- Internal SECURITY DEFINER helpers were executable by anon and authenticated.
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and the
-- helpers below were created without the REVOKE that the client-facing RPCs
-- pair with their GRANT. Through PostgREST that meant anyone holding the anon
-- key could call /rest/v1/rpc/_send_notification_email with any recipient,
-- template and data (mail from our domain), _send_push_notification to any
-- user, the _notify_* senders, and the _get_*_email lookups.
--
-- Verified in prod on 2026-10-18 before this change: every reference to these
-- thirteen functions is from a SECURITY DEFINER function (trigger functions
-- included), none from a policy or a view, and no client code calls them
-- directly. The service role keeps EXECUTE, so the edge functions and pg_cron
-- are unaffected. Every new internal helper must carry the same REVOKE
-- (20261019100000_game_videos.sql shows the pattern).

REVOKE ALL ON FUNCTION _send_notification_email(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _send_push_notification(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _notify_team_share(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _notify_user_share(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _notify_seat_limit_hit(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _get_user_email(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _get_org_admin_email(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _get_org_admin_emails(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _get_platform_admin_emails() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _import_allowance(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _device_cap_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _is_player_only(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _playlist_has_shipped_clips(uuid) FROM PUBLIC, anon, authenticated;
