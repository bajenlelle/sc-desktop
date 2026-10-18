#!/usr/bin/env bash
#
# Checks for cloud game videos (20261019100000).
#
# Only the uploader reads a copy's row; nobody writes rows from a client. The
# cap per tier is enforced by the insert trigger, a replacement doesn't count
# against it, _game_video_mark_ready swaps the game's older copy out, and a
# match deleted by its owner queues the copy's key for the purge.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261019100000_game_videos.sql supabase/tests/game_videos.sh   # before db push
#   supabase/tests/game_videos.sh                                                                  # after
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler), because `db query --db-url` sends one prepared statement at a time
# and can't hold a BEGIN … ROLLBACK. The URL is never printed; its password is
# masked out of any output.
set -euo pipefail
trap 'echo "game_videos.sh: failed at line $LINENO" >&2' ERR

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

MODE=cli
MASK=""
if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  MODE=psql
  PSQL="${PSQL_BIN:-$(command -v psql || true)}"
  if [[ -z "$PSQL" ]]; then echo "SUPABASE_DB_URL is set but psql was not found (set PSQL_BIN)." >&2; exit 1; fi
  MASK="${SUPABASE_DB_URL#*//}"; MASK="${MASK#*:}"; MASK="${MASK%%@*}"   # the password
  echo "# Target: psql over SUPABASE_DB_URL (password masked in output)"
else
  BIN="$(pick_supabase || true)"
  if [[ -z "$BIN" ]]; then
    echo "No supabase CLI with 'db query' found. Update it or set SUPABASE_BIN." >&2
    exit 1
  fi
fi
mask() { if [[ -n "$MASK" ]]; then local s="$1"; echo "${s//"$MASK"/***}"; else echo "$1"; fi; }

q1() {  # first column of the first row of a privileged query
  if [[ "$MODE" == psql ]]; then
    "$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -c "$1" </dev/null 2>/dev/null | head -1 | cut -d'|' -f1
  else
    "$BIN" db query --linked "$1" </dev/null 2>/dev/null \
      | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); r=json.loads(m.group(0))["rows"]; print(list(r[0].values())[0] if r else "")'
  fi
}

# One probe transaction. Prints something the classifier in run() reads the
# same way for both transports: the CLI's JSON, or for psql the errors (with
# SQLSTATEs, so "P0001: token" and "42501" appear as in the CLI's output)
# followed by a `"n": <value>` line built from the last row the probe printed.
probe() {  # $1=sql
  if [[ "$MODE" == psql ]]; then
    local rows errs status
    errs="$(mktemp)"
    rows="$("$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f - <<<$'\\set VERBOSITY verbose\n'"$1" 2>"$errs")" && status=0 || status=$?
    cat "$errs"; rm -f "$errs"
    if [[ $status -eq 0 ]]; then
      local n; n="$(grep -v '^$' <<<"$rows" | tail -1 || true)"
      echo "\"n\": ${n:-?}"
    fi
  else
    "$BIN" db query --linked "$1" </dev/null 2>&1 || true
  fi
}

# U uploads the probe copy, V is another signed-in user.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
echo "# U=$U (uploader)  V=$V (someone else)"

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
  out="$(probe "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q '"_tag":"Error"\|ERROR:' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1 || true)"
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

M=game-video-probe-match                         # a throwaway game owned by U
M2=game-video-probe-match-2                      # a second one, to fill the cap
A=00000000-0000-4000-8000-00000a0b0c01           # a ready copy
B=00000000-0000-4000-8000-00000a0b0c02           # an upload in progress
KEY_A=probe/games/$M/$A.mp4
KEY_B=probe/games/$M/$B.mp4
# The national-team league never counts against the import quota, so the
# probe imports always succeed whatever U's plan is.
MAKE_MATCH="INSERT INTO matches (id, user_id, title, league_id) VALUES ($(d $M), $(d $U), $(d 'cloud copy probe'), 'sweden-national-men');"
MAKE_MATCH2="INSERT INTO matches (id, user_id, title, league_id) VALUES ($(d $M2), $(d $U), $(d 'cloud copy probe 2'), 'sweden-national-men');"
ROW_OTHER="INSERT INTO game_videos (match_id, uploaded_by, status, storage_key, ready_at) VALUES ($(d $M2), $(d $U), 'ready', 'probe/other.mp4', now());"
LIMIT_ONE="UPDATE app_config SET value = '{\"free\":1}' WHERE key = 'game_video_limits';"
SWITCH_OFF="UPDATE app_config SET value = 'false' WHERE key = 'cloud_video_enabled';"
ROW_A="INSERT INTO game_videos (id, match_id, uploaded_by, status, storage_key, size_bytes, ready_at) VALUES ($(d $A), $(d $M), $(d $U), 'ready', $(d $KEY_A), 100, now());"
ROW_B="INSERT INTO game_videos (id, match_id, uploaded_by, status, storage_key, upload_id, part_size, size_bytes) VALUES ($(d $B), $(d $M), $(d $U), 'uploading', $(d $KEY_B), 'upl-1', 33554432, 100);"
insert_b() { echo "WITH x AS ($(sed 's/;$//' <<<"$ROW_B") RETURNING 1) SELECT count(*) AS n FROM x"; }

echo "== reading (the uploader, someone else)"
run "the uploader reads the copy"                   "ALLOWED rows=1" "SELECT count(*) AS n FROM game_videos WHERE match_id = $(d $M)" "$MAKE_MATCH $ROW_A"
ACTOR="$V" run "someone else reads nothing"           "ALLOWED rows=0" "SELECT count(*) AS n FROM game_videos WHERE match_id = $(d $M)" "$MAKE_MATCH $ROW_A"
run "the quota meter answers"                       "ALLOWED rows=2" "SELECT (get_game_video_quota(NULL)->>'max_games')::int AS n" ""

echo "== writing from a client (never)"
run "the uploader can't insert a row"               "DENIED"         "$(insert_b)" "$MAKE_MATCH"
run "the uploader can't change a row"               "ALLOWED rows=0" "WITH x AS (UPDATE game_videos SET status = 'failed' WHERE id = $(d $A) RETURNING 1) SELECT count(*) AS n FROM x" "$MAKE_MATCH $ROW_A"
run "the uploader can't delete a row"               "ALLOWED rows=0" "WITH x AS (DELETE FROM game_videos WHERE id = $(d $A) RETURNING 1) SELECT count(*) AS n FROM x" "$MAKE_MATCH $ROW_A"

echo "== the cap and the switch (the function, as service role)"
ROLE=service_role run "the function inserts an upload"            "ALLOWED rows=1"                   "$(insert_b)" "$MAKE_MATCH"
ROLE=service_role run "at the cap, a new game is refused"         "RAISES:game_video_limit_reached"  "$(insert_b)" "$MAKE_MATCH $MAKE_MATCH2 $LIMIT_ONE $ROW_OTHER"
ROLE=service_role run "at the cap, replacing the same game is fine" "ALLOWED rows=1"                 "$(insert_b)" "$MAKE_MATCH $LIMIT_ONE $ROW_A"
ROLE=service_role run "switched off, every insert is refused"     "RAISES:feature_disabled"          "$(insert_b)" "$MAKE_MATCH $SWITCH_OFF"

echo "== finishing an upload"
ROLE=service_role run "mark ready swaps the older copy out"       "ALLOWED rows=1" "SELECT count(*) AS n FROM game_videos WHERE id = $(d $B) AND status = 'ready' AND upload_id IS NULL" "$MAKE_MATCH $ROW_A $ROW_B SELECT _game_video_mark_ready($(d $B));"
ROLE=service_role run "and queues the older copy's key"           "ALLOWED rows=1" "SELECT count(*) AS n FROM game_video_deletions WHERE storage_key = $(d $KEY_A) AND upload_id IS NULL" "$MAKE_MATCH $ROW_A $ROW_B SELECT _game_video_mark_ready($(d $B));"
ROLE=service_role run "marking ready twice is harmless"           "ALLOWED rows=1" "SELECT count(*) AS n FROM game_videos WHERE id = $(d $B) AND status = 'ready'" "$MAKE_MATCH $ROW_B SELECT _game_video_mark_ready($(d $B)); SELECT _game_video_mark_ready($(d $B));"

echo "== deleting"
run "the owner deletes the game"                    "ALLOWED rows=1" "WITH x AS (DELETE FROM matches WHERE id = $(d $M) RETURNING 1) SELECT count(*) AS n FROM x" "$MAKE_MATCH $ROW_A"
run "which queues the copy's key"                   "ALLOWED rows=1" "DELETE FROM matches WHERE id = $(d $M); RESET ROLE; SELECT count(*) AS n FROM game_video_deletions WHERE storage_key = $(d $KEY_A)" "$MAKE_MATCH $ROW_A"
run "an unfinished upload queues its upload id too" "ALLOWED rows=1" "DELETE FROM matches WHERE id = $(d $M); RESET ROLE; SELECT count(*) AS n FROM game_video_deletions WHERE storage_key = $(d $KEY_B) AND upload_id = 'upl-1'" "$MAKE_MATCH $ROW_B"

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
