-- Rename plan tiers: 'pro' -> 'rookie', 'max' -> 'pro'.
-- Final tiers: free, rookie, pro, franchise.

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_tier_check;

UPDATE organizations SET plan_tier = 'rookie' WHERE plan_tier = 'pro';
UPDATE organizations SET plan_tier = 'pro'    WHERE plan_tier = 'max';

ALTER TABLE organizations
  ADD CONSTRAINT organizations_plan_tier_check
  CHECK (plan_tier IN ('free', 'rookie', 'pro', 'franchise'));
