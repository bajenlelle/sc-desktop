-- Filter presets: a coach saves the clip filters they keep setting (a name and the filters) and
-- applies them again from a Presets menu.
-- A preset is scoped like `labels` (20260514000000): one coach's own in one space, read and
-- written by that coach alone, so one club's presets never show in another space and a player
-- sharing a playlist never sees them. Names are unique per coach and space, case-insensitive, as
-- label names are; saving a name that is taken is refused, never overwritten.
-- Access is RLS only, so there is no function here: the policy and the grants follow
-- scouting_report_drafts (20261101100000), and WITH CHECK also asks that the space is one the
-- coach belongs to. move_to_club does not carry presets: they stay in the space they were saved in.

-- `filters` is the apps' saved filter object. The check holds it to version 1 and 16 KB.
-- IS NOT DISTINCT FROM, because a missing key makes `=` NULL, and a NULL check passes.
CREATE TABLE filter_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  filters    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filter_presets_filters_check CHECK (
    jsonb_typeof(filters) = 'object'
    AND filters->>'v' IS NOT DISTINCT FROM '1'
    AND octet_length(filters::text) <= 16384
  )
);
CREATE UNIQUE INDEX filter_presets_user_org_name_idx ON filter_presets (user_id, org_id, lower(name));

-- The owner's alone. auth.uid() once per query.
ALTER TABLE filter_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY filter_presets_owner ON filter_presets
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = filter_presets.org_id AND m.user_id = (SELECT auth.uid()))
  );

-- The apps read and write the owner's rows; anon never touches the table.
-- TRUNCATE isn't subject to RLS, so the default grant of it goes too.
GRANT SELECT, INSERT, UPDATE, DELETE ON filter_presets TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON filter_presets FROM authenticated;
REVOKE ALL ON filter_presets FROM anon;
