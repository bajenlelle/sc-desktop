CREATE TABLE IF NOT EXISTS playlist_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE playlist_folders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playlist_folders'
    AND policyname = 'Users manage own folders'
  ) THEN
    CREATE POLICY "Users manage own folders"
      ON playlist_folders FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
