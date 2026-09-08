-- ============================================================================
-- Cross-platform color-theme sync (Slack-style)
--
-- One chosen theme per light/dark slot plus the selected light/dark/system
-- appearance mode, per user, so a pick on any device applies on the others.
-- NULL means "never synced": clients keep their device defaults and never
-- write these columns without an explicit user action, so existing users see
-- no change until they pick a theme somewhere.
--
-- Written by the client via the existing profiles_update_own RLS policy —
-- no new policy needed (same pattern as celebrated_plan_tier and the
-- onboarding dismiss flags). Slot ids are an open set (clients validate
-- against packages/shared/lib/themes.ts and degrade unknown ids to the
-- default palette without clobbering them back), so only theme_mode gets a
-- CHECK.
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS theme_dark text,
  ADD COLUMN IF NOT EXISTS theme_light text,
  ADD COLUMN IF NOT EXISTS theme_mode text
    CHECK (theme_mode IN ('light', 'dark', 'system'));

-- ----------------------------------------------------------------------------
-- First Realtime use in this project: add profiles to the WAL publication so
-- postgres_changes can deliver own-row UPDATE events. Clients subscribe with
-- filter id=eq.<own uid>; Realtime additionally enforces the profiles SELECT
-- policies per subscriber (WALRUS), so nothing becomes visible that a plain
-- SELECT would not already show. Guarded so re-runs and environments missing
-- the default publication are both safe.
--
-- REPLICA IDENTITY stays DEFAULT (pk): UPDATE payloads carry the full new
-- row (all clients consume); `old` is pk-only. FULL would only add WAL
-- overhead.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;
