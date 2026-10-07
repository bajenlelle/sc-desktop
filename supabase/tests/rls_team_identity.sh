#!/usr/bin/env bash
#
# Access and linking checks for team identity (20261009100000).
#
# league_teams / league_team_sources are public league data: readable by any
# signed-in user, written only by the service role through sync_league_teams.
# space_team_choices is each user's own answer per space, read through RLS and
# written through set_my_team. These probes prove the access rules, the
# season-to-season linking of source ids, and that club suggestions never
# reveal who picked a team.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261009100000_team_identity.sql supabase/tests/rls_team_identity.sh   # before db push
#   supabase/tests/rls_team_identity.sh                                                                     # after
set -euo pipefail

cd "$(dirname "$0")/../.."

pick_supabase() {
  local c
  for c in "${SUPABASE_BIN:-}" \
           $(find "$HOME/.npm/_npx" -path '*/node_modules/.bin/supabase' 2>/dev/null) \
           "$(command -v supabase || true)"; do
    [[ -n "$c" && -x "$c" ]] || continue
    if "$c" db query --help </dev/null 2>&1 | grep -q "Execute a SQL query"; then
      echo "$c"; return 0
    fi
  done
  return 1
}
BIN="$(pick_supabase || true)"
if [[ -z "$BIN" ]]; then
  echo "No supabase CLI with 'db query' found. Update it or set SUPABASE_BIN." >&2
  exit 1
fi

q1() {  # first column of the first row of a privileged query
  "$BIN" db query --linked "$1" </dev/null 2>/dev/null \
    | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); r=json.loads(m.group(0))["rows"]; print(list(r[0].values())[0] if r else "")'
}

# U answers, V is another signed-in user. P is U's personal space.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
P="$(q1 "SELECT o.id::text AS p FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = \$\$$U\$\$ AND o.is_personal LIMIT 1")"
echo "# U=$U  V=$V  P=$P (U's personal space)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS) | RAISES:<token> (guard) | BLOCKED (either)
  local out got st actor="${ACTOR:-$U}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out=$("$BIN" db query --linked "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" </dev/null 2>&1 || true)
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q '"_tag":"Error"' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$2:$got" in
    BLOCKED:DENIED*|BLOCKED:RAISES:*) st="PASS";;
    *) case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac;;
  esac
  printf "  %-62s expect=%-28s got=%-30s %s\n" "$1" "$2" "$got" "$st"
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Two seasons of a made-up source catalogue (club keys can't collide with real ones).
#   c1: one men's team, moves league and renames between seasons.
#   c2: two men's teams in two leagues, both rename.
#   c3: two men's teams; "Gamma" is promoted with an unchanged name.
#   c4: a new club in season 2.
S1="SELECT sync_league_teams($(d genius), $(d probe-herr),  $(d 'Probe Herr'),  $(d 2025-26), $(d men), $(d '[{"id":"p-t1","name":"Alpha","clubId":"probe-c1","clubName":"Alpha IF"},{"id":"p-t2","name":"Beta","clubId":"probe-c2","clubName":"Beta BK"}]'));
    SELECT sync_league_teams($(d genius), $(d probe-ettan), $(d 'Probe Ettan'), $(d 2025-26), $(d men), $(d '[{"id":"p-t3","name":"Beta Utv","clubId":"probe-c2"},{"id":"p-t4","name":"Gamma","clubId":"probe-c3"}]'));
    SELECT sync_league_teams($(d genius), $(d probe-tvaan), $(d 'Probe Tvaan'), $(d 2025-26), $(d men), $(d '[{"id":"p-t6","name":"Gamma Dev","clubId":"probe-c3"}]'));"
S2="SELECT sync_league_teams($(d genius), $(d probe-herr),  $(d 'Probe Herr'),  $(d 2026-27), $(d men), $(d '[{"id":"p-t2b","name":"Beta Basket","clubId":"probe-c2"},{"id":"p-t4b","name":"Gamma","clubId":"probe-c3"},{"id":"p-t5","name":"Delta","clubId":"probe-c4"}]'));
    SELECT sync_league_teams($(d genius), $(d probe-ettan), $(d 'Probe Ettan'), $(d 2026-27), $(d men), $(d '[{"id":"p-t1b","name":"Alpha BK","clubId":"probe-c1"},{"id":"p-t3b","name":"Beta U","clubId":"probe-c2"}]'));"
SEED_TEAMS="$S1 $S2"
team() { printf "(SELECT league_team_id FROM league_team_sources WHERE source = \$\$genius\$\$ AND source_team_id = \$\$%s\$\$)" "$1"; }

echo "# Linking source ids across seasons (as the service role)"
ROLE=service_role run "one team per club: linked across league and rename" "ALLOWED rows=1" "$SEED_TEAMS SELECT count(*) AS n FROM league_teams WHERE club_key = \$\$genius:probe-c1\$\$ AND name = \$\$Alpha BK\$\$ AND league_id = \$\$probe-ettan\$\$ AND $(team p-t1) = $(team p-t1b)"
ROLE=service_role run "two teams of one club: linked by league"        "ALLOWED rows=2" "$SEED_TEAMS SELECT (SELECT count(*) FROM league_teams WHERE club_key = \$\$genius:probe-c2\$\$) * (CASE WHEN $(team p-t2) = $(team p-t2b) AND $(team p-t3) = $(team p-t3b) THEN 1 ELSE 0 END) AS n"
ROLE=service_role run "promotion with an unchanged name: linked"       "ALLOWED rows=1" "$SEED_TEAMS SELECT count(*) AS n FROM league_teams WHERE id = $(team p-t4) AND id = $(team p-t4b) AND league_id = \$\$probe-herr\$\$"
ROLE=service_role run "…and the club's other team is left alone"       "ALLOWED rows=1" "$SEED_TEAMS SELECT count(*) AS n FROM league_teams WHERE id = $(team p-t6) AND name = \$\$Gamma Dev\$\$ AND season_id = \$\$2025-26\$\$"
ROLE=service_role run "a new club starts a new team"                   "ALLOWED rows=1" "$SEED_TEAMS SELECT count(*) AS n FROM league_teams WHERE club_key = \$\$genius:probe-c4\$\$"
ROLE=service_role run "re-syncing an older season keeps the newest name" "ALLOWED rows=1" "$SEED_TEAMS $S1 SELECT count(*) AS n FROM league_teams WHERE id = $(team p-t1) AND name = \$\$Alpha BK\$\$ AND season_id = \$\$2026-27\$\$"
ROLE=service_role run "re-syncing is idempotent"                       "ALLOWED rows=6" "$SEED_TEAMS $S2 $S1 SELECT count(*) AS n FROM league_teams WHERE club_key LIKE \$\$genius:probe-%\$\$"
ROLE=service_role run "sync with a bad gender"                         "RAISES:invalid_gender" "SELECT sync_league_teams($(d genius), $(d probe-herr), $(d 'Probe Herr'), $(d 2025-26), $(d mixed), $(d '[]'))"

echo "# Catalogue access"
run "read league_teams"                                "ALLOWED rows=6" "SELECT count(*) AS n FROM league_teams WHERE club_key LIKE \$\$genius:probe-%\$\$" "$SEED_TEAMS"
run "read league_team_sources"                         "ALLOWED rows=10" "SELECT count(*) AS n FROM league_team_sources WHERE source_team_id LIKE \$\$p-t%\$\$" "$SEED_TEAMS"
run "insert league_teams directly"                     "DENIED" "INSERT INTO league_teams (name, league_id, league_name, season_id) VALUES (\$\$X\$\$, \$\$x\$\$, \$\$X\$\$, \$\$2026-27\$\$)"
run "update league_teams directly"                     "ALLOWED rows=0" "WITH u AS (UPDATE league_teams SET name = \$\$X\$\$ RETURNING 1) SELECT count(*) AS n FROM u" "$SEED_TEAMS"
run "call sync_league_teams as a user"                 "DENIED" "SELECT sync_league_teams($(d genius), $(d probe-herr), $(d 'Probe Herr'), $(d 2025-26), $(d men), $(d '[]'))"
ROLE=anon run "read league_teams as anon"              "ALLOWED rows=0" "SELECT count(*) AS n FROM league_teams" "$SEED_TEAMS"

# A throwaway club space K with U and V, and K2 with only V.
K="00000000-0000-4000-8000-0000000000c1"
K2="00000000-0000-4000-8000-0000000000c2"
SEED_SPACES="$SEED_TEAMS
  INSERT INTO organizations (id, name) VALUES (\$\$$K\$\$, \$\$Probe club\$\$), (\$\$$K2\$\$, \$\$Probe club 2\$\$);
  INSERT INTO org_memberships (user_id, org_id, role) VALUES (\$\$$U\$\$, \$\$$K\$\$, \$\$player\$\$), (\$\$$V\$\$, \$\$$K\$\$, \$\$coach\$\$), (\$\$$V\$\$, \$\$$K2\$\$, \$\$coach\$\$);"
V_PICKS_BETA="INSERT INTO space_team_choices (user_id, org_id, league_team_id) VALUES (\$\$$V\$\$, \$\$$K\$\$, $(team p-t2));"
MINE="SELECT count(*) AS n FROM space_team_choices WHERE user_id = \$\$$U\$\$"

echo "# Choosing a team"
run "pick a team for two spaces at once"               "ALLOWED rows=2" "SELECT set_my_team(ARRAY[\$\$$K\$\$, \$\$$P\$\$]::uuid[], $(team p-t2b), NULL); $MINE AND league_team_id = $(team p-t2) AND org_id IN (\$\$$K\$\$, \$\$$P\$\$)" "$SEED_SPACES"
run "a second pick replaces the first"                 "ALLOWED rows=1" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], $(team p-t2), NULL); SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], $(team p-t5), NULL); $MINE AND org_id = \$\$$P\$\$ AND league_team_id = $(team p-t5)" "$SEED_SPACES"
run "skipping is recorded as an answer"                "ALLOWED rows=1" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], NULL, NULL); $MINE AND org_id = \$\$$P\$\$ AND league_team_id IS NULL AND unlisted_team IS NULL" "$SEED_SPACES"
run "an unlisted team is saved as a note"              "ALLOWED rows=1" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], NULL, \$\$  Sollentuna U16, Div 2 \$\$); $MINE AND org_id = \$\$$P\$\$ AND unlisted_team = \$\$Sollentuna U16, Div 2\$\$" "$SEED_SPACES"
run "a picked team wins over a note"                   "ALLOWED rows=1" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], $(team p-t5), \$\$note\$\$); $MINE AND org_id = \$\$$P\$\$ AND unlisted_team IS NULL" "$SEED_SPACES"
run "an over-long note"                                "RAISES:unlisted_team_too_long" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], NULL, repeat(\$\$x\$\$, 121))" "$SEED_SPACES"
run "a space the caller is not in"                     "RAISES:not_member" "SELECT set_my_team(ARRAY[\$\$$P\$\$, \$\$$K2\$\$]::uuid[], NULL, NULL)" "$SEED_SPACES"
run "an unknown team"                                  "RAISES:unknown_team" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], gen_random_uuid(), NULL)" "$SEED_SPACES"
run "no spaces at all"                                 "RAISES:invalid_spaces" "SELECT set_my_team(ARRAY[]::uuid[], NULL, NULL)"
run "insert a choice directly"                         "DENIED" "INSERT INTO space_team_choices (user_id, org_id) VALUES (\$\$$U\$\$, \$\$$P\$\$)"
ROLE=anon run "set_my_team as anon"                    "BLOCKED" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], NULL, NULL)"

echo "# Privacy"
ACTOR="$V" run "another user can't read my choices"    "ALLOWED rows=0" "$MINE" "$SEED_SPACES INSERT INTO space_team_choices (user_id, org_id, league_team_id) VALUES (\$\$$U\$\$, \$\$$K\$\$, $(team p-t1));"
run "leaving a club deletes the choice"                "ALLOWED rows=0" "$MINE AND org_id = \$\$$K\$\$" "$SEED_SPACES INSERT INTO space_team_choices (user_id, org_id, league_team_id) VALUES (\$\$$U\$\$, \$\$$K\$\$, $(team p-t1)); DELETE FROM org_memberships WHERE user_id = \$\$$U\$\$ AND org_id = \$\$$K\$\$;"

echo "# Club suggestions"
run "a teammate's pick suggests the whole club"        "ALLOWED rows=2" "SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$K\$\$) s WHERE s.club_key = \$\$genius:probe-c2\$\$" "$SEED_SPACES $V_PICKS_BETA"
run "…and nothing else"                                "ALLOWED rows=2" "SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$K\$\$)" "$SEED_SPACES $V_PICKS_BETA"
run "suggestions never carry who picked"               "ALLOWED rows=0" "SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$K\$\$) s WHERE to_jsonb(s) ?| ARRAY[\$\$user_id\$\$, \$\$picked_by\$\$]" "$SEED_SPACES $V_PICKS_BETA"
run "no suggestions in a personal space"               "ALLOWED rows=0" "SELECT set_my_team(ARRAY[\$\$$P\$\$]::uuid[], $(team p-t2), NULL); SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$P\$\$)" "$SEED_SPACES"
run "suggestions for a space the caller is not in"     "RAISES:not_member" "SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$K2\$\$)" "$SEED_SPACES $V_PICKS_BETA"
ROLE=anon run "suggestions as anon"                    "BLOCKED" "SELECT count(*) AS n FROM get_space_team_suggestions(\$\$$K\$\$)"

if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
