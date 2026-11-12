#!/usr/bin/env bash
#
# Checks for archiving a game (20261112100000): matches.archived_at.
#
# The column is the game owner's to write, like the rest of the row: nobody
# else changes it and anon never touches the table. Archiving only sets the
# time (NULL = in the library): the owner still reads the game, its plays stay,
# and a playlist that holds one of its clips keeps it.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261112100000_archive_games.sql supabase/tests/archive_games.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/archive_games.sh                                                                   # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "archive_games.sh: failed at line $LINENO" >&2' ERR

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
W="00000000-0000-4000-8000-0000000a4c01"    # the coach who owns the game
V="00000000-0000-4000-8000-0000000a4c02"    # someone else
L="00000000-0000-4000-8000-0000000a4c11"    # the owner's playlist
G=archive-probe-game
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
NT=$(d sweden-national-men)

SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-archive-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-archive-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key) VALUES ($(d $W), $PW, $(d $G), $NT, $(d probe-archive-src));
  INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES ($(d $G), $(d $W), $PW, $(d 'Probe game'), $NT, $(d probe-archive-src));
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES ($(d $G), 101, '2pt', 1);
  INSERT INTO playlists (id, user_id, org_id, name) VALUES ($(d $L), $(d $W), $PW, $(d 'Probe list'));
  INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES ($(d $L), $(d $G), 101, 0);"

set_archived() {  # $1=a SQL timestamptz expression
  echo "WITH x AS (UPDATE matches SET archived_at = $1 WHERE id = $(d $G) RETURNING 1) SELECT count(*) AS n FROM x"
}
ARCHIVE="UPDATE matches SET archived_at = now() WHERE id = $(d $G)"

echo "# W=$W (owner)  V=$V (someone else)"
echo "== the owner's game"
run "a new game is not archived"                     "ALLOWED rows=1" "SELECT count(*) AS n FROM matches WHERE id = $(d $G) AND archived_at IS NULL"
run "the owner archives the game"                    "ALLOWED rows=1" "$(set_archived "now()")"
run "…and still reads it"                            "ALLOWED rows=1" "$ARCHIVE; SELECT count(*) AS n FROM matches WHERE id = $(d $G) AND archived_at IS NOT NULL"
run "…and its plays"                                 "ALLOWED rows=1" "$ARCHIVE; SELECT count(*) AS n FROM play_by_play_events WHERE match_id = $(d $G)"
run "…and its playlist keeps the clip"               "ALLOWED rows=1" "$ARCHIVE; SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $L) AND match_id = $(d $G)"
run "the owner brings it back"                       "ALLOWED rows=1" "$(set_archived NULL)"

echo "== everyone else"
ACTOR=$V run "someone else archives nothing"         "ALLOWED rows=0" "$(set_archived "now()")"
ROLE=anon run "anon archives nothing"                "ALLOWED rows=0" "$(set_archived "now()")"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
