#!/usr/bin/env bash
#
# Checks for league players (20261119100000): league_players and league_player_teams.
#
# Public roster data (names, number, photo key) is readable by any signed-in user. Birth date,
# height, weight and nationality are stored for later and readable by the service role only.
# Only the service role writes (the genius function's roster sync). anon reads nothing.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261119100000_genius_players.sql supabase/tests/genius_players.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/genius_players.sh                                                                     # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "genius_players.sh: failed at line $LINENO" >&2' ERR

cd "$(dirname "$0")/../.."

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Set SUPABASE_DB_URL (the target's session pooler URL); this script runs through psql." >&2
  exit 1
fi
PSQL="${PSQL_BIN:-$(command -v psql || true)}"
if [[ -z "$PSQL" ]]; then echo "psql was not found (set PSQL_BIN)." >&2; exit 1; fi
MASK="${SUPABASE_DB_URL#*//}"; MASK="${MASK#*:}"; MASK="${MASK%%@*}"   # the password
echo "# Target: psql over SUPABASE_DB_URL (password masked in output)"
mask() { if [[ -n "$MASK" ]]; then local s="$1"; echo "${s//"$MASK"/***}"; else echo "$1"; fi; }

# One probe transaction: the errors (with SQLSTATEs) followed by a `"n": <value>`
# line built from the last row the probe printed.
probe() {  # $1=sql
  local rows errs status
  errs="$(mktemp)"
  rows="$("$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f - <<<$'\\set VERBOSITY verbose\n'"$1" 2>"$errs")" && status=0 || status=$?
  cat "$errs"; rm -f "$errs"
  if [[ $status -eq 0 ]]; then
    local n; n="$(grep -v '^$' <<<"$rows" | tail -1 || true)"
    echo "\"n\": ${n:-?}"
  fi
}

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor
  # expected: ALLOWED rows=N | DENIED (RLS / privilege) | ERR:<sqlstate>
  local out got st actor="${ACTOR:-$W}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $SEED SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -q 'ERROR:' <<<"$out"; then
    got="ERR:$(grep -oE 'ERROR: +[0-9A-Z]{5}' <<<"$out" | head -1 | grep -oE '[0-9A-Z]{5}$' || true)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-58s expect=%-22s got=%-22s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

# Any signed-in user: these tables don't depend on who asks.
W="00000000-0000-4000-8000-0000001a7101"
PID="999000001"
SEED="INSERT INTO league_players (source, source_person_id, first_name, family_name, default_shirt_number, dob, height_cm, weight_kg, nationality, photo_key, photo_source)
  VALUES (\$\$genius\$\$, \$\$$PID\$\$, \$\$Probe\$\$, \$\$Player\$\$, \$\$7\$\$, \$\$2005-01-02\$\$, 190, 85, \$\$Sweden\$\$, \$\$players/genius/$PID/0123456789abcdef-S1.jpg\$\$, \$\$0123456789abcdef\$\$);
  INSERT INTO league_player_teams (source, source_person_id, source_team_id, league_id, season_id, shirt_number)
  VALUES (\$\$genius\$\$, \$\$$PID\$\$, \$\$probe-team\$\$, \$\$probe-league\$\$, \$\$2026-27\$\$, \$\$7\$\$);"
ONE="WHERE source_person_id = \$\$$PID\$\$"

echo "# Signed-in users: public columns only"
run "read name, number and photo key"                       "ALLOWED rows=1" "SELECT count(*) FROM league_players $ONE AND photo_key IS NOT NULL AND first_name = \$\$Probe\$\$"
run "read birth date"                                       "DENIED" "SELECT dob FROM league_players $ONE"
run "read height and weight"                                "DENIED" "SELECT height_cm, weight_kg FROM league_players $ONE"
run "read nationality"                                      "DENIED" "SELECT nationality FROM league_players $ONE"
run "select *"                                              "DENIED" "SELECT * FROM league_players $ONE"
run "read team-seasons"                                     "ALLOWED rows=1" "SELECT count(*) FROM league_player_teams $ONE"
run "insert a player"                                       "DENIED" "INSERT INTO league_players (source, source_person_id) VALUES (\$\$genius\$\$, \$\$999000002\$\$)"
run "update a photo key"                                    "DENIED" "UPDATE league_players SET photo_key = NULL $ONE"
run "delete a player"                                       "DENIED" "DELETE FROM league_players $ONE"
run "insert a team-season"                                  "DENIED" "INSERT INTO league_player_teams (source, source_person_id, source_team_id, league_id, season_id) VALUES (\$\$genius\$\$, \$\$$PID\$\$, \$\$x\$\$, \$\$x\$\$, \$\$x\$\$)"
run "run the season audit"                                  "DENIED" "SELECT run_genius_season_audit()"

echo "# anon"
ROLE=anon run "read players"                                "DENIED" "SELECT count(*) FROM league_players"
ROLE=anon run "read team-seasons"                           "DENIED" "SELECT count(*) FROM league_player_teams"
ROLE=anon run "run the season audit"                        "DENIED" "SELECT run_genius_season_audit()"

echo "# Service role (the roster sync)"
ROLE=service_role run "reads every column"                  "ALLOWED rows=1" "SELECT count(*) FROM league_players $ONE AND dob = \$\$2005-01-02\$\$ AND height_cm = 190"
ROLE=service_role run "updates a photo"                     "ALLOWED rows=1" "WITH u AS (UPDATE league_players SET photo_key = NULL $ONE RETURNING 1) SELECT count(*) FROM u"
ROLE=service_role run "deleting a player removes its team-seasons" "ALLOWED rows=0" "DELETE FROM league_players $ONE; SELECT count(*) FROM league_player_teams $ONE"

if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
