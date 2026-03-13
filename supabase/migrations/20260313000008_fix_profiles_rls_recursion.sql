-- Fix: profiles_select_own_or_same_org contained a self-referential subquery
-- (`SELECT org_id FROM profiles WHERE id = auth.uid()`) which causes infinite
-- recursion when querying profiles filtered by org_id. Replace the inner
-- table-scan with a SECURITY DEFINER helper that bypasses RLS.

CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS profiles_select_own_or_same_org ON profiles;

CREATE POLICY profiles_select_own_or_same_org ON profiles
  FOR SELECT USING (
    id = (SELECT auth.uid())
    OR (
      org_id IS NOT NULL
      AND org_id = current_user_org_id()
    )
  );
