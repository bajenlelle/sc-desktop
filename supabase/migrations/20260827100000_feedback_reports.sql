-- =============================================================================
-- User bug/feedback reports ("Report a problem" in all three apps).
--
-- Rows are written only through the `report-issue` edge function (service
-- role) — RLS allows users to read their own reports and platform admins to
-- read everything, but no client writes. The edge function also files a
-- GitHub issue; `github_issue_number` links back to it. Screenshots go to
-- the private `feedback-screenshots` bucket, served to admins via short-lived
-- signed URLs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id              uuid REFERENCES organizations(id) ON DELETE SET NULL,
  app                 text NOT NULL CHECK (app IN ('desktop', 'web', 'mobile')),
  app_version         text NOT NULL,
  os                  text,
  route               text,
  description         text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
  sentry_event_id     text,
  screenshot_path     text,
  github_issue_number integer,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved'))
);

CREATE INDEX IF NOT EXISTS feedback_reports_created_idx ON feedback_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_reports_user_idx ON feedback_reports (user_id, created_at DESC);

ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

-- Users can see their own reports; platform admins see all. No client
-- INSERT/UPDATE/DELETE policies — writes go through the edge function only.
CREATE POLICY "own reports" ON feedback_reports
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "platform admin reads all" ON feedback_reports
  FOR SELECT USING (is_platform_admin());

-- Private bucket for report screenshots (2 MB cap, images only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- No storage policies: uploads and signed-URL reads both happen with the
-- service role (edge function / admin API), which bypasses RLS.

-- Admin status toggle for the /admin/feedback inbox.
CREATE OR REPLACE FUNCTION admin_set_feedback_status(p_report_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;
  IF p_status NOT IN ('open', 'triaged', 'resolved') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE feedback_reports SET status = p_status WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_feedback_status(uuid, text) TO authenticated;
