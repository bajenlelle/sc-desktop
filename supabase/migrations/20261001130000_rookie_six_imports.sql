-- =============================================================================
-- Rookie: 6 game imports a month (was 10)
--
-- Leonard, 2026-10-01. _import_allowance is the single source of truth for
-- every limit; packages/shared/lib/plan-tier.ts mirrors it for display.
-- Otherwise identical to 20260826200000_import_grants_and_quota. Free (3
-- lifetime) and paid (unlimited) are unchanged, grants still add on top, and
-- the window is still the calendar month.
--
-- Prod at the change: 0 orgs on Rookie, so nobody is over the new limit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._import_allowance(p_user uuid, p_org uuid)
 RETURNS TABLE(tier text, win text, base_limit integer, bonus integer, used integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier  text;
  v_win   text;
  v_base  int;
  -- Same values as NT_LEAGUE_IDS in packages/shared/lib/plan-tier.ts —
  -- national-team imports never count against the quota.
  v_nt    text[] := ARRAY['sweden-national-men', 'sweden-national-women'];
BEGIN
  SELECT o.plan_tier INTO v_tier FROM organizations o WHERE o.id = p_org;
  v_tier := COALESCE(v_tier, 'free');

  IF v_tier = 'free' THEN
    v_win := 'lifetime'; v_base := 3;
  ELSIF v_tier = 'rookie' THEN
    v_win := 'month'; v_base := 6;
  ELSE
    v_win := 'unlimited'; v_base := NULL;
  END IF;

  RETURN QUERY SELECT
    v_tier,
    v_win,
    v_base,
    (SELECT COALESCE(SUM(g.amount), 0)::int FROM import_grants g
      WHERE (g.user_id IS NULL OR g.user_id = p_user)
        AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())),
    (SELECT COUNT(*)::int FROM import_log il
      WHERE il.user_id = p_user
        AND (p_org IS NULL OR il.org_id = p_org)
        AND (il.league_id IS NULL OR NOT (il.league_id = ANY(v_nt)))
        AND (v_win <> 'month' OR il.created_at >= date_trunc('month', now())));
END;
$function$;
