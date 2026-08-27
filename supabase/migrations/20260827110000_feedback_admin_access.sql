-- Admin access for the /admin/feedback inbox:
-- 1. Storage SELECT policy so platform admins can create signed URLs for
--    report screenshots from the client (writes stay service-role-only).
-- 2. Listing RPC that joins the reporter's email from auth.users, which no
--    client-side select can reach.

CREATE POLICY "platform admin reads feedback screenshots"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback-screenshots' AND is_platform_admin());

CREATE OR REPLACE FUNCTION admin_list_feedback_reports()
RETURNS TABLE (
  id                  uuid,
  created_at          timestamptz,
  email               text,
  app                 text,
  app_version         text,
  os                  text,
  route               text,
  description         text,
  sentry_event_id     text,
  screenshot_path     text,
  github_issue_number integer,
  status              text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'not_platform_admin';
  END IF;

  RETURN QUERY
    SELECT fr.id, fr.created_at, u.email::text, fr.app, fr.app_version, fr.os,
           fr.route, fr.description, fr.sentry_event_id, fr.screenshot_path,
           fr.github_issue_number, fr.status
      FROM feedback_reports fr
      LEFT JOIN auth.users u ON u.id = fr.user_id
      ORDER BY fr.created_at DESC
      LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_feedback_reports() TO authenticated;
