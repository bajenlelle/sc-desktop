create or replace function get_team_member_counts(org_id uuid)
returns table(team_id uuid, member_count bigint)
language sql security definer
stable
set search_path = public
as $$
  select tm.team_id, count(*)::bigint
  from team_members tm
  join teams t on t.id = tm.team_id
  where t.org_id = $1
  group by tm.team_id;
$$;
