-- Drop the old 4-param overload of generate_org_invite that was created before
-- p_is_national_team was added. The 5-param version (with DEFAULT false) covers both cases.
DROP FUNCTION IF EXISTS public.generate_org_invite(uuid, text, integer, integer);
