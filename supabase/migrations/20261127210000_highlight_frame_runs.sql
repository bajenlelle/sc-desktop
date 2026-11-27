-- Highlight framing (2026-11-27, player highlights): the `highlight-frame` edge function sends a clip's frames to
-- Claude to find the player and the rim, so the desktop can crop the clip to 9:16 by itself. Like tip-off detection
-- (20261006100000), every model call is logged here by the service role, for the per-user daily limit and for cost.
-- A highlight of 8 clips is 8 calls at about $0.065 each with Claude Opus 5.5 (tracking-spike/claude_report.md).
-- Kill switch: app_config.highlight_frame_enabled. Daily calls per user: app_config.highlight_frame_daily_limit.

CREATE TABLE highlight_frame_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  frame_count   integer NOT NULL,
  model         text NOT NULL,
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  fallback      boolean NOT NULL DEFAULT false,   -- the request was finished by the fallback model
  outcome       text NOT NULL,                    -- ok | model_refused | model_truncated | parse_failed | api_error
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX highlight_frame_runs_user_id_created_at_idx ON highlight_frame_runs (user_id, created_at DESC);

-- Server-written only: RLS with no policies, and no grants to the apps' roles.
ALTER TABLE highlight_frame_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON highlight_frame_runs FROM anon, authenticated;

INSERT INTO app_config (key, value) VALUES
  ('highlight_frame_enabled', 'true'),
  ('highlight_frame_daily_limit', '80')
ON CONFLICT (key) DO NOTHING;
