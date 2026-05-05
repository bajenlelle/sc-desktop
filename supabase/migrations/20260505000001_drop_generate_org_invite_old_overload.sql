-- Drop the stale 5-param overload of generate_org_invite left behind when
-- migration 20260429000002 added the 6-param version via CREATE OR REPLACE.
-- CREATE OR REPLACE only replaces an exact signature match, so the old
-- overload persisted, causing Postgres to raise an ambiguous function error
-- whenever the caller omits p_team_id.
DROP FUNCTION IF EXISTS generate_org_invite(uuid, text, integer, integer, boolean);
