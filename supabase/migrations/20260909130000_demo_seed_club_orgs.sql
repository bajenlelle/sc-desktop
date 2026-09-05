-- 20260909130000: Seed the sample game into club orgs too (per staff member)
--
-- seed_demo_match was personal-space-only, so club spaces stayed empty until
-- a real import and staff couldn't try clips → playlists where they actually
-- work. Matches are per-owner (RLS: owner + playlist-visible, no org read),
-- so "the club's sample game" means one demo per STAFF MEMBER per club space
-- — the same per-user model as personal, scoped to the club org so it shows
-- in that space's Library and clip browser. Players get nothing in club (they
-- can't act there; their demo lives in the personal space).
--
-- Idempotency moves from profiles.demo_seeded_at (one flag per user, ever) to
-- demo_seeds (one row per user+org): still "deleting the sample game never
-- resurrects it", but each space gets its own seed. The claim insert is the
-- guard, so concurrent boots can't double-seed. profiles.demo_seeded_at stays
-- as a dead legacy column.

CREATE TABLE demo_seeds (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

-- Definer-only, like demo_templates: RLS on, zero policies.
ALTER TABLE demo_seeds ENABLE ROW LEVEL SECURITY;

-- Backfill the legacy per-user flag as a personal-org claim so existing users
-- keep their "never resurrect" guarantee there (their club spaces are new
-- territory and seed on next boot).
INSERT INTO demo_seeds (user_id, org_id, seeded_at)
SELECT p.id, om.org_id, p.demo_seeded_at
FROM profiles p
JOIN org_memberships om ON om.user_id = p.id
JOIN organizations o ON o.id = om.org_id AND o.is_personal
WHERE p.demo_seeded_at IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION seed_demo_match(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_is_personal boolean;
  v_tpl demo_templates;
  v_match_id text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Member of the org; in club spaces only staff seed (a player's boot must
  -- not create club content they own).
  SELECT o.is_personal INTO v_is_personal
  FROM org_memberships om
  JOIN organizations o ON o.id = om.org_id
  WHERE om.user_id = v_uid
    AND om.org_id = p_org_id
    AND (o.is_personal OR om.role IN ('admin', 'coach'));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- enforce_license_on_import has no is_demo exemption and would RAISE out of
  -- a fire-and-forget boot call — locked clubs simply don't get seeded.
  IF NOT v_is_personal AND org_license_state(p_org_id) = 'locked' THEN
    RETURN NULL;
  END IF;

  -- Before the claim: shipping dark (no template yet) must not burn the
  -- user's one seed for this org.
  SELECT * INTO v_tpl FROM demo_templates WHERE id = 'default';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The claim IS the idempotency + race guard: one seed per user+org, ever —
  -- deleting the sample game doesn't resurrect it, and concurrent boots
  -- collide here instead of double-inserting.
  INSERT INTO demo_seeds (user_id, org_id) VALUES (v_uid, p_org_id)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Personal keeps the legacy id (existing rows); club ids carry the org so
  -- one user can hold a demo per space. (Demo clips never reach the R2
  -- presign path — Clip & Ship rejects remote sources first — so the longer
  -- id never meets the clip-key regex.)
  v_match_id := CASE WHEN v_is_personal
                     THEN 'demo-' || v_uid
                     ELSE 'demo-' || v_uid || '-' || p_org_id
                END;

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

  RETURN v_match_id;
END $$;

-- The original migration relied on default EXECUTE TO PUBLIC — make the
-- grant explicit per house style.
GRANT EXECUTE ON FUNCTION seed_demo_match(uuid) TO authenticated;
