#!/usr/bin/env bash
#
# Checks the Data API grants of the cloud game video tables (20261023100000) and
# scouting_reports (20261024100000):
# signed-in users read game_videos and render_jobs and can't write them, the
# service role works all four, the queues are closed to clients, anon sees
# none. Read-only: it only asks has_table_privilege.
#
#   SUPABASE_DB_URL=<session pooler url> supabase/tests/table_grants.sh   # e.g. staging, through psql
#   supabase/tests/table_grants.sh                                        # the linked project
set -euo pipefail
cd "$(dirname "$0")/../.."

ask() {  # $1=role $2=table $3=privilege -> t|f
  local sql="SELECT has_table_privilege('$1', 'public.$2', '$3')"
  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    psql "$SUPABASE_DB_URL" -X -q -A -t -c "$sql" </dev/null
  else
    npx --yes supabase db query --linked "$sql" </dev/null \
      | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); r=json.loads(m.group(0))["rows"]; print("t" if list(r[0].values())[0] else "f")'
  fi
}

FAILED=0
check() {  # $1=role $2=table $3=privilege $4=expected(t|f)
  local got; got="$(ask "$1" "$2" "$3")"
  if [[ "$got" == "$4" ]]; then echo "PASS  $1 $3 on $2 = $got"; else echo "FAIL  $1 $3 on $2: expected $4, got $got"; FAILED=1; fi
}

for t in game_videos render_jobs; do
  check authenticated $t SELECT t
  for p in INSERT UPDATE DELETE; do check authenticated $t $p f; done
done
for t in game_video_deletions media_deletions; do
  for p in SELECT INSERT UPDATE DELETE; do check authenticated $t $p f; done
done
# scouting_reports (20261024100000): the owner reads through RLS, nothing writes from a client.
check authenticated scouting_reports SELECT t
for p in INSERT UPDATE DELETE; do check authenticated scouting_reports $p f; done
for t in game_videos render_jobs game_video_deletions media_deletions scouting_reports; do
  for p in SELECT INSERT UPDATE DELETE; do check service_role $t $p t; done
  check anon $t SELECT f
done
exit $FAILED
