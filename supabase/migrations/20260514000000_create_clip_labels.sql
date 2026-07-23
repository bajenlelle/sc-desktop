-- =============================================================================
-- Clip labels: per-(user, org) vocabulary + per-clip assignments.
-- A "clip" is identified by (match_id, event_id) — same as play_by_play_events.
-- Labels are private to the user; sharing a playlist does not expose them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vocabulary table
-- ---------------------------------------------------------------------------
-- Named `labels` (not `clip_labels`) so a follow-up `playlist_label_assignments`
-- can reuse the same vocabulary.
CREATE TABLE labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  color      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX labels_user_org_name_idx
  ON labels (user_id, org_id, lower(name));

CREATE INDEX labels_user_org_idx ON labels (user_id, org_id);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY labels_owner_all ON labels
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Assignment table
-- ---------------------------------------------------------------------------
CREATE TABLE clip_label_assignments (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_id    text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_id    bigint NOT NULL,
  label_id    uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, match_id, event_id, label_id)
);

CREATE INDEX cla_clip_idx
  ON clip_label_assignments (user_id, org_id, match_id, event_id);

CREATE INDEX cla_label_idx ON clip_label_assignments (label_id);

ALTER TABLE clip_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cla_owner_all ON clip_label_assignments
  FOR ALL
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Auto-seed default basketball labels for every (user, org) pair
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_default_labels(p_user uuid, p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO labels (user_id, org_id, name, color) VALUES
    (p_user, p_org, 'Pick & Roll',     'violet'),
    (p_user, p_org, 'Pick & Pop',      'fuchsia'),
    (p_user, p_org, 'Iso',             'amber'),
    (p_user, p_org, 'Transition',      'orange'),
    (p_user, p_org, 'Drive',           'cyan'),
    (p_user, p_org, 'Cut',             'teal'),
    (p_user, p_org, 'Off-ball Screen', 'indigo'),
    (p_user, p_org, 'Good Defense',    'emerald'),
    (p_user, p_org, 'Bad Defense',     'red'),
    (p_user, p_org, 'Switch',          'sky'),
    (p_user, p_org, 'Closeout',        'blue'),
    (p_user, p_org, 'Box Out',         'slate')
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_default_labels(uuid, uuid) TO authenticated;

-- Trigger function wrapping the seed call.
CREATE OR REPLACE FUNCTION seed_default_labels_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_default_labels(NEW.user_id, NEW.org_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_labels_on_membership
  AFTER INSERT ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION seed_default_labels_trigger();

-- ---------------------------------------------------------------------------
-- 4. Backfill: every existing (user, org) pair gets the starter pack.
--    Idempotent via ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT user_id, org_id FROM org_memberships LOOP
    PERFORM seed_default_labels(r.user_id, r.org_id);
  END LOOP;
END;
$$;
