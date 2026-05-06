-- Add org_id to matches table for workspace-scoped content
ALTER TABLE matches ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- Backfill existing matches to the uploading user's primary org
UPDATE matches m
SET org_id = p.org_id
FROM profiles p
WHERE m.user_id = p.id AND m.org_id IS NULL AND p.org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_org_id_idx ON matches(org_id);
