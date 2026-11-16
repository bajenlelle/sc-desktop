#!/usr/bin/env bash
#
# Checks for a game's marks (20261111100000): matches.game_marks.
#
# The column is the game owner's to write, like the rest of the row: nobody
# else changes it and anon never touches the table. The check holds it to an
# object of at most 32 KB (or NULL, "not read yet").
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261111100000_game_marks.sql supabase/tests/game_marks.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/game_marks.sh                                                                # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "game_marks.sh: failed at line $LINENO" >&2' ERR

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
  printf "  %-62s expect=%-16s got=%-18s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Throwaway accounts that sign up inside every probe, so handle_new_user gives
# each a personal space. The fixture game is logged as imported first, so it
# inserts whatever the account's plan and the project's import rules are.
W="00000000-0000-4000-8000-0000000e4a01"    # the coach who owns the game
V="00000000-0000-4000-8000-0000000e4a02"    # someone else
G=gm-probe-game
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
NT=$(d sweden-national-men)

SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-marks-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-marks-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key) VALUES ($(d $W), $PW, $(d $G), $NT, $(d probe-marks-src));
  INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES ($(d $G), $(d $W), $PW, $(d 'Probe game'), $NT, $(d probe-marks-src));"

MARKS='{"v":1,"source":"genius","periods":{"1":{"startRealWorldTime":"2026-01-10T17:00:00Z"}},"timeouts":[{"eventId":148,"period":1,"clock":"02:37","realWorldTime":"2026-01-10T17:20:25Z","kind":"team","teamNumber":1,"scoreHome":15,"scoreAway":14}]}'
set_marks() {  # $1=a SQL jsonb expression
  echo "WITH x AS (UPDATE matches SET game_marks = $1 WHERE id = $(d $G) RETURNING 1) SELECT count(*) AS n FROM x"
}

echo "# W=$W (owner)  V=$V (someone else)"
echo "== the owner's game"
run "a new game has no marks"                        "ALLOWED rows=1" "SELECT count(*) AS n FROM matches WHERE id = $(d $G) AND game_marks IS NULL"
run "the owner stores the game's marks"              "ALLOWED rows=1" "$(set_marks "$(d "$MARKS")::jsonb")"
run "…and reads them back"                           "ALLOWED rows=1" "UPDATE matches SET game_marks = $(d "$MARKS")::jsonb WHERE id = $(d $G); SELECT count(*) AS n FROM matches WHERE id = $(d $G) AND game_marks->'timeouts'->0->>'clock' = '02:37'"
run "…and clears them"                               "ALLOWED rows=1" "$(set_marks NULL)"

echo "== the check"
run "an array is refused"                            "ERR:23514"      "$(set_marks "'[]'::jsonb")"
run "a string is refused"                            "ERR:23514"      "$(set_marks "'\"marks\"'::jsonb")"
run "more than 32 KB is refused"                     "ERR:23514"      "$(set_marks "jsonb_build_object('v', 1, 'pad', repeat('x', 33000))")"
run "just under 32 KB is kept"                       "ALLOWED rows=1" "$(set_marks "jsonb_build_object('v', 1, 'pad', repeat('x', 32000))")"

echo "== everyone else"
ACTOR=$V run "someone else changes nothing"          "ALLOWED rows=0" "$(set_marks "$(d "$MARKS")::jsonb")"
ROLE=anon run "anon changes nothing"                 "ALLOWED rows=0" "$(set_marks "$(d "$MARKS")::jsonb")"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
