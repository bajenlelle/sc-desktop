-- One-time "thanks for upgrading" celebration flag.
--
-- Stores the highest paid tier the user has already been congratulated on,
-- so the dialog shows exactly once across web and desktop combined (a
-- localStorage flag can't do that — Tauri's webview has its own storage).
-- NULL = never celebrated. Written by the client via the existing
-- profiles_update_own RLS policy; no new policy needed.
ALTER TABLE profiles
  ADD COLUMN celebrated_plan_tier text
  CHECK (celebrated_plan_tier IN ('rookie', 'pro'));

-- Backfill: users already on a paid plan today shouldn't get a retroactive
-- "thanks for upgrading" weeks after the fact. Stripe only writes tiers to
-- personal orgs, so that's the org we key on.
UPDATE profiles p
SET celebrated_plan_tier = o.plan_tier
FROM org_memberships m
JOIN organizations o ON o.id = m.org_id
WHERE m.user_id = p.id
  AND o.is_personal
  AND o.plan_tier IN ('rookie', 'pro');
