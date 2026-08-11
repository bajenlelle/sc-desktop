-- =============================================================================
-- New-user onboarding: dismissal flags, demo game template + seeding
-- =============================================================================

-- 1. Profile flags. First two are written client-side via the existing
--    profiles_update_own policy (same pattern as celebrated_plan_tier);
--    demo_seeded_at is written only by seed_demo_match and survives the user
--    deleting the sample game, so it never resurrects.
ALTER TABLE profiles
  ADD COLUMN onboarding_checklist_dismissed_at timestamptz,
  ADD COLUMN welcome_dismissed_at timestamptz,
  ADD COLUMN demo_seeded_at timestamptz;

-- Onboarding is for new signups only: mark everyone who already has an
-- account as done with all of it.
UPDATE profiles
SET onboarding_checklist_dismissed_at = now(),
    welcome_dismissed_at = now(),
    demo_seeded_at = now();

-- 2. Sample-game marker. The demo row is owned by the user like any other
--    match (RLS, delete, playlists all work unchanged); the flag drives
--    quota exclusion, the "Sample game" badge, and replace-video gating.
ALTER TABLE matches
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- 3. Template: a single designated row holding the canonical sample game.
--    Events are denormalized to jsonb here only — the per-user copy unpacks
--    them back into play_by_play_events. No RLS policies: only the SECURITY
--    DEFINER functions below may touch it.
CREATE TABLE demo_templates (
  id          text PRIMARY KEY DEFAULT 'default',
  title       text NOT NULL,
  game_date   date,
  home_team   jsonb NOT NULL DEFAULT '{}',
  away_team   jsonb NOT NULL DEFAULT '{}',
  home_roster jsonb NOT NULL DEFAULT '[]',
  away_roster jsonb NOT NULL DEFAULT '[]',
  video_url   text NOT NULL,              -- public R2 https URL
  sync_point  jsonb NOT NULL,
  league_id   text,
  season_id   text,
  stage_id    text,
  events      jsonb NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE demo_templates ENABLE ROW LEVEL SECURITY;

-- 4. Authoring: snapshot a normally-imported match (+ its events) into the
--    template. Run by a platform admin after uploading the video to R2:
--      SELECT admin_capture_demo_template('<match-id>', '<r2-public-url>');
CREATE FUNCTION admin_capture_demo_template(p_match_id text, p_video_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = p_match_id) THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  INSERT INTO demo_templates (id, title, game_date, home_team, away_team,
                              home_roster, away_roster, video_url, sync_point,
                              league_id, season_id, stage_id, events)
  SELECT 'default', m.title, m.game_date, m.home_team, m.away_team,
         m.home_roster, m.away_roster, p_video_url, m.sync_point,
         m.league_id, m.season_id, m.stage_id,
         COALESCE((SELECT jsonb_agg(to_jsonb(e) - 'id' - 'match_id' ORDER BY e.real_world_time)
                   FROM play_by_play_events e WHERE e.match_id = m.id), '[]'::jsonb)
  FROM matches m WHERE m.id = p_match_id
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, game_date = EXCLUDED.game_date,
    home_team = EXCLUDED.home_team, away_team = EXCLUDED.away_team,
    home_roster = EXCLUDED.home_roster, away_roster = EXCLUDED.away_roster,
    video_url = EXCLUDED.video_url, sync_point = EXCLUDED.sync_point,
    league_id = EXCLUDED.league_id, season_id = EXCLUDED.season_id,
    stage_id = EXCLUDED.stage_id, events = EXCLUDED.events, updated_at = now();
END $$;

-- 5. Seeding: copy the template into the caller's personal org, once per
--    user ever. No-ops (returns NULL) when already seeded, when the target
--    org isn't the caller's personal org, or when no template is configured
--    yet — so the feature ships dark until the footage is captured.
CREATE FUNCTION seed_demo_match(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_tpl demo_templates;
  v_match_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND demo_seeded_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = v_uid AND om.org_id = p_org_id AND o.is_personal
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tpl FROM demo_templates WHERE id = 'default';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_match_id := 'demo-' || v_uid;

  INSERT INTO matches (id, user_id, org_id, title, game_date, home_team, away_team,
                       home_roster, away_roster, video_url, sync_point,
                       league_id, season_id, stage_id, is_demo)
  VALUES (v_match_id, v_uid, p_org_id, v_tpl.title, v_tpl.game_date, v_tpl.home_team,
          v_tpl.away_team, v_tpl.home_roster, v_tpl.away_roster, v_tpl.video_url,
          v_tpl.sync_point, v_tpl.league_id, v_tpl.season_id, v_tpl.stage_id, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO play_by_play_events (match_id, event_id, type, sub_type, period,
                                   game_clock_time, real_world_time, is_successful,
                                   player, event_team, qualifiers)
  SELECT v_match_id,
         (e->>'event_id')::bigint,
         e->>'type',
         e->>'sub_type',
         (e->>'period')::smallint,
         e->>'game_clock_time',
         (e->>'real_world_time')::timestamptz,
         (e->>'is_successful')::smallint,
         e->'player',
         e->'event_team',
         CASE WHEN e ? 'qualifiers' AND jsonb_typeof(e->'qualifiers') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(e->'qualifiers'))
         END
  FROM jsonb_array_elements(v_tpl.events) e
  ON CONFLICT (match_id, event_id) DO NOTHING;

  UPDATE profiles SET demo_seeded_at = now() WHERE id = v_uid;
  RETURN v_match_id;
END $$;

-- 6. The sample game must not consume the monthly import quota.
CREATE OR REPLACE FUNCTION count_club_matches_this_month(
  p_nt_league_ids text[] DEFAULT '{}',
  p_org_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::integer FROM matches
  WHERE user_id = auth.uid()
    AND created_at >= date_trunc('month', now())
    AND (p_org_id IS NULL OR org_id = p_org_id)
    AND (league_id IS NULL OR NOT (league_id = ANY(p_nt_league_ids)))
    AND NOT is_demo;
$$;
