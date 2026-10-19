#!/usr/bin/env bash
#
# Checks for render jobs (20261020100000): the server-cut clips of a web
# playlist, and the server export's jobs (20261021100000).
#
# The owner reads their own jobs and nobody writes one from a client; one live
# job per (playlist, kind, aspect, purpose); the notification to pending
# shares runs without an auth gate for the function only, while the desktop's
# RPC keeps its owner check; `_playlist_is_shared` tells shared playlists
# apart; the retention retires week-old finished jobs (30-day-old share
# exports) and never a live one; the sweep's gate fires for a queued render
# job. Exports: the phase check, the plan an export is billed to, and a
# download's file queued for the purge whenever its row goes, by retention or
# cascade, never a key of another shape.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261021100000_export_jobs.sql supabase/tests/render_jobs.sh   # before db push
#   supabase/tests/render_jobs.sh                                                                  # after
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler), because `db query --db-url` sends one prepared statement at a time
# and can't hold a BEGIN … ROLLBACK. The URL is never printed; its password is
# masked out of any output.
set -euo pipefail
trap 'echo "render_jobs.sh: failed at line $LINENO" >&2' ERR

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

# U owns the probe playlist, V is another signed-in user.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
echo "# U=$U (owner)  V=$V (someone else)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

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

# A throwaway club K with U as a coach and V as a player, U's playlist P in
# it, a game M of U's with one clip in P, and render jobs J1/J2 on P. The
# national-team league never counts against the import quota.
K=00000000-0000-4000-8000-00000000d0c1
P=00000000-0000-4000-8000-00000000d0a1
M=render-jobs-probe-match
J1=00000000-0000-4000-8000-00000000d0e1
J2=00000000-0000-4000-8000-00000000d0e2
CLUB="INSERT INTO organizations (id, name, is_personal) VALUES ($(d $K), $(d 'Render probe club'), false);
      INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $U), $(d $K), 'coach'), ($(d $V), $(d $K), 'player');"
PLAYLIST="INSERT INTO playlists (id, user_id, name, org_id) VALUES ($(d $P), $(d $U), $(d 'render probe'), $(d $K));"
MATCH="INSERT INTO matches (id, user_id, title, league_id, org_id) VALUES ($(d $M), $(d $U), $(d 'render probe game'), 'sweden-national-men', $(d $K));"
CLIP="INSERT INTO playlist_clips (playlist_id, match_id, event_id, position, item_type) VALUES ($(d $P), $(d $M), 42, 0, 'clip');"
SHIPPED="UPDATE playlist_clips SET r2_url = 'https://media.example/clips/$M/42_pre10.0_post3.0_s120.0.mp4' WHERE playlist_id = $(d $P);"
# A direct share from U to V, inserted while the playlist has no file yet, so it stays pending.
SHARE="INSERT INTO playlist_user_shares (playlist_id, user_id, shared_by) VALUES ($(d $P), $(d $V), $(d $U));"
job() {  # $1=id $2=status [$3=extra columns] [$4=extra values]
  echo "INSERT INTO render_jobs (id, kind, playlist_id, user_id, org_id, status${3:+, $3}) VALUES ($(d $1), 'ship', $(d $P), $(d $U), $(d $K), $(d $2)${4:+, $4});"
}
BASE="$CLUB $PLAYLIST $MATCH $CLIP"
insert_live() {  # a second live ship job for P, refused by the live index when one exists
  echo "WITH x AS (INSERT INTO render_jobs (kind, playlist_id, user_id, status) VALUES ('ship', $(d $P), $(d $U), 'queued') ON CONFLICT (playlist_id, kind, (COALESCE(request->>'aspect', '')), (COALESCE(request->>'purpose', ''))) WHERE status IN ('queued', 'running') DO NOTHING RETURNING 1) SELECT count(*) AS n FROM x"
}

echo "== reading (the owner, someone else)"
run "the owner reads their job"                        "ALLOWED rows=1" "SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $(job $J1 queued)"
ACTOR="$V" run "someone else reads nothing"              "ALLOWED rows=0" "SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $(job $J1 queued)"
run "the web's poll: the latest job of the playlist"   "ALLOWED rows=1" "SELECT count(*) AS n FROM (SELECT id, kind, playlist_id, status, phase, request, progress, requeue, result, error, attempt, created_at, finished_at FROM render_jobs WHERE playlist_id = $(d $P) AND kind = 'ship' ORDER BY created_at DESC LIMIT 1) x" "$BASE $(job $J1 done)"

echo "== writing from a client (never)"
run "the owner can't insert a job"                     "DENIED"         "$(insert_live)" "$BASE"
run "the owner can't change a job"                     "ALLOWED rows=0" "WITH x AS (UPDATE render_jobs SET status = 'done' WHERE id = $(d $J1) RETURNING 1) SELECT count(*) AS n FROM x" "$BASE $(job $J1 queued)"
run "the owner can't delete a job"                     "ALLOWED rows=0" "WITH x AS (DELETE FROM render_jobs WHERE id = $(d $J1) RETURNING 1) SELECT count(*) AS n FROM x" "$BASE $(job $J1 queued)"

echo "== the function (as service role)"
ROLE=service_role run "the function inserts a job"                        "ALLOWED rows=1" "$(insert_live)" "$BASE"
ROLE=service_role run "a second live job for the playlist is refused"     "ALLOWED rows=0" "$(insert_live)" "$BASE $(job $J1 queued)"
ROLE=service_role run "…also while the first one runs"                    "ALLOWED rows=0" "$(insert_live)" "$BASE $(job $J1 running)"
ROLE=service_role run "a finished job doesn't block a new one"            "ALLOWED rows=1" "$(insert_live)" "$BASE $(job $J1 done)"
EXPORT_WIDE="INSERT INTO render_jobs (id, kind, playlist_id, user_id, status, request) VALUES ($(d $J2), 'export', $(d $P), $(d $U), 'queued', '{\"aspect\":\"16:9\"}');"
export_tall() { echo "WITH x AS (INSERT INTO render_jobs (kind, playlist_id, user_id, status, request) VALUES ('export', $(d $P), $(d $U), 'queued', '{\"aspect\":\"$1\"}') ON CONFLICT (playlist_id, kind, (COALESCE(request->>'aspect', '')), (COALESCE(request->>'purpose', ''))) WHERE status IN ('queued', 'running') DO NOTHING RETURNING 1) SELECT count(*) AS n FROM x"; }
ROLE=service_role run "an export of another aspect is its own live job"   "ALLOWED rows=1" "$(export_tall 9:16)" "$BASE $(job $J1 queued) $EXPORT_WIDE"
ROLE=service_role run "the same aspect twice is not"                      "ALLOWED rows=0" "$(export_tall 16:9)" "$BASE $EXPORT_WIDE"
ROLE=service_role run "updated_at follows a change"                       "ALLOWED rows=1" "UPDATE render_jobs SET status = 'running' WHERE id = $(d $J1); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1) AND updated_at >= created_at AND updated_at > now() - interval '1 minute'" "$BASE $(job $J1 queued)"
ROLE=service_role run "a bad status is refused"                           "ERR:"           "INSERT INTO render_jobs (kind, playlist_id, user_id, status) VALUES ('ship', $(d $P), $(d $U), 'paused')" "$BASE"
ROLE=service_role run "deleting the playlist takes its jobs along"        "ALLOWED rows=0" "DELETE FROM playlists WHERE id = $(d $P); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $(job $J1 done)"

echo "== notifying pending shares"
run "the internal notify is not the user's to call"                       "DENIED"           "SELECT _notify_pending_shares_for_playlist($(d $P))" "$BASE"
ACTOR="$V" run "the public RPC refuses a non-owner"                       "RAISES:not_owner" "SELECT notify_pending_playlist_shares($(d $P))" "$BASE"
ROLE=anon run "and anyone signed out"                                     "BLOCKED"          "SELECT notify_pending_playlist_shares($(d $P))" "$BASE"
run "a share inserted before any file is pending"                         "ALLOWED rows=1"   "SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $P) AND notified_at IS NULL" "$BASE $SHARE"
run "the owner's RPC delivers it once a file exists"                      "ALLOWED rows=1"   "SELECT notify_pending_playlist_shares($(d $P)); SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $P) AND notified_at IS NOT NULL" "$BASE $SHARE $SHIPPED"
run "but not before"                                                      "ALLOWED rows=0"   "SELECT notify_pending_playlist_shares($(d $P)); SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $P) AND notified_at IS NOT NULL" "$BASE $SHARE"
ROLE=service_role run "the function's internal notify delivers it too"    "ALLOWED rows=1"   "SELECT _notify_pending_shares_for_playlist($(d $P)); SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $P) AND notified_at IS NOT NULL" "$BASE $SHARE $SHIPPED"
ROLE=service_role run "and twice is harmless"                             "ALLOWED rows=1"   "SELECT _notify_pending_shares_for_playlist($(d $P)); SELECT _notify_pending_shares_for_playlist($(d $P)); SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $P) AND notified_at IS NOT NULL" "$BASE $SHARE $SHIPPED"

echo "== is the playlist shared?"
ROLE=service_role run "a direct share counts"                             "ALLOWED rows=1" "SELECT _playlist_is_shared($(d $P))::int AS n" "$BASE $SHARE"
ROLE=service_role run "a team share counts"                               "ALLOWED rows=1" "SELECT _playlist_is_shared($(d $P))::int AS n" "$BASE INSERT INTO teams (id, org_id, name) VALUES ($(d 00000000-0000-4000-8000-00000000d0b1), $(d $K), 'Probe U17'); INSERT INTO playlist_shares (playlist_id, team_id) VALUES ($(d $P), $(d 00000000-0000-4000-8000-00000000d0b1));"
ROLE=service_role run "an unshared playlist doesn't"                      "ALLOWED rows=0" "SELECT _playlist_is_shared($(d $P))::int AS n" "$BASE"
run "and the helper is not the user's to call"                            "DENIED"         "SELECT _playlist_is_shared($(d $P))" "$BASE"

echo "== retention"
OLD_DONE="$(job $J1 done 'finished_at' "now() - interval '8 days'")"
NEW_DONE="$(job $J2 done 'finished_at' "now() - interval '6 days'")"
OLD_LIVE="$(job $J2 queued 'created_at, updated_at' "now() - interval '30 days', now() - interval '30 days'")"
ROLE=service_role run "an 8-day-old finished job is retired"              "ALLOWED rows=0" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $OLD_DONE $NEW_DONE"
ROLE=service_role run "a 6-day-old one stays"                             "ALLOWED rows=1" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J2)" "$BASE $OLD_DONE $NEW_DONE"
ROLE=service_role run "a live job is never retired, however old"          "ALLOWED rows=1" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J2)" "$BASE $OLD_LIVE"
run "the retention is not the user's to run"                              "DENIED"         "SELECT _render_jobs_retention()" ""

echo "== the sweep's gate"
# Everything live is removed first (rolled back with the rest), so the gate sees exactly the probe's rows.
QUIET="DELETE FROM render_jobs; DELETE FROM game_videos;"
QUEUED_CALLS="SELECT LEAST(count(*), 1) AS n FROM net.http_request_queue WHERE url LIKE '%/game-video' AND convert_from(body, 'utf8') LIKE '%\"sweep\"%'"
ROLE=service_role run "a queued render job makes the sweep call the function" "ALLOWED rows=1" "SELECT run_game_video_sweep(); RESET ROLE; $QUEUED_CALLS" "$QUIET $BASE $(job $J1 queued)"
ROLE=service_role run "a running one too"                                     "ALLOWED rows=1" "SELECT run_game_video_sweep(); RESET ROLE; $QUEUED_CALLS" "$QUIET $BASE $(job $J1 running 'heartbeat_at' 'now()')"
ROLE=service_role run "with nothing live the sweep stays quiet"               "ALLOWED rows=0" "SELECT run_game_video_sweep(); RESET ROLE; $QUEUED_CALLS" "$QUIET $BASE $(job $J1 done)"
ROLE=service_role run "the sweep retires old jobs on its way"                 "ALLOWED rows=0" "SELECT run_game_video_sweep(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$QUIET $BASE $OLD_DONE"
run "the sweep is not the user's to run"                                      "DENIED"         "SELECT run_game_video_sweep()" ""

echo "== exports (20261021100000)"
J3=00000000-0000-4000-8000-00000000d0e3
P2=00000000-0000-4000-8000-00000000d0a2
REF=probe-ref   # any prefix: the trigger checks a key's shape, the function's purge its project's prefix
dl_key() { echo "$REF/exports/$U/$1.mp4"; }   # $1=job id: its download's key, as the function mints it
keys_of() { echo "{\"keys\":{\"video\":\"$1\"}}"; }   # the params render_take writes, as far as the trigger reads them
# An export's request ($1=purpose $2=aspect). Built by printf: a comma between braces in a double-quoted
# $(…) argument is brace-expanded by bash into two words.
request_of() { printf '{"aspect":"%s","purpose":"%s"}' "$2" "$1"; }
# An export job of P: $1=id $2=status $3=purpose $4=aspect [$5=params json] [$6=finished this many days ago]
export_job() {
  local cols="" vals="" req
  req="$(request_of "$3" "$4")"
  if [[ -n "${5:-}" ]]; then cols+=", params"; vals+=", $(d "$5")::jsonb"; fi
  if [[ -n "${6:-}" ]]; then cols+=", finished_at"; vals+=", now() - interval '$6 days'"; fi
  echo "INSERT INTO render_jobs (id, kind, playlist_id, user_id, org_id, status, request$cols) VALUES ($(d $1), 'export', $(d $P), $(d $U), $(d $K), $(d $2), $(d "$req")::jsonb$vals);"
}
live_export() {  # $1=purpose $2=aspect: another live export of P, refused by the live index when one of that purpose and aspect exists
  local req; req="$(request_of "$1" "$2")"
  echo "WITH x AS (INSERT INTO render_jobs (kind, playlist_id, user_id, status, request) VALUES ('export', $(d $P), $(d $U), 'queued', $(d "$req")::jsonb) ON CONFLICT (playlist_id, kind, (COALESCE(request->>'aspect', '')), (COALESCE(request->>'purpose', ''))) WHERE status IN ('queued', 'running') DO NOTHING RETURNING 1) SELECT count(*) AS n FROM x"
}
queued() { echo "SELECT count(*) AS n FROM game_video_deletions WHERE storage_key = $(d "$1")"; }
tier_is() { echo "SELECT (_export_tier_for_playlist($(d $1)) = $(d $2))::int AS n"; }
personal_tier() { echo "UPDATE organizations SET plan_tier = $(d $1) WHERE is_personal AND id IN (SELECT org_id FROM org_memberships WHERE user_id = $(d $U));"; }
UNSCOPED="INSERT INTO playlists (id, user_id, name) VALUES ($(d $P2), $(d $U), $(d 'render probe, no club'));"

ROLE=service_role run "a download and a share of one aspect run together"    "ALLOWED rows=1" "$(live_export share 16:9)"    "$BASE $(export_job $J1 queued download 16:9)"
ROLE=service_role run "a second download of that aspect is refused"          "ALLOWED rows=0" "$(live_export download 16:9)" "$BASE $(export_job $J1 running download 16:9)"
ROLE=service_role run "…and a second share of it"                            "ALLOWED rows=0" "$(live_export share 16:9)"    "$BASE $(export_job $J1 queued share 16:9)"
ROLE=service_role run "a download of the other aspect is its own"            "ALLOWED rows=1" "$(live_export download 9:16)" "$BASE $(export_job $J1 queued download 16:9)"
ROLE=service_role run "an export never blocks a ship"                        "ALLOWED rows=1" "$(insert_live)"               "$BASE $(export_job $J1 queued download 16:9)"
ROLE=service_role run "an export reports its phase"                          "ALLOWED rows=1" "UPDATE render_jobs SET phase = 'stitch' WHERE id = $(d $J1); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1) AND phase = 'stitch'" "$BASE $(export_job $J1 running download 16:9)"
ROLE=service_role run "a phase it doesn't know is refused"                   "ERR:"           "UPDATE render_jobs SET phase = 'cutting' WHERE id = $(d $J1)" "$BASE $(export_job $J1 running download 16:9)"

ROLE=service_role run "a club's playlist exports on the club's plan"         "ALLOWED rows=1" "$(tier_is $P franchise)" "$BASE UPDATE organizations SET plan_tier = 'franchise' WHERE id = $(d $K);"
ROLE=service_role run "a free club's playlist is free"                       "ALLOWED rows=1" "$(tier_is $P free)"      "$BASE"
ROLE=service_role run "outside a club, the owner's personal plan: free"      "ALLOWED rows=1" "$(tier_is $P2 free)"     "$BASE $UNSCOPED $(personal_tier free)"
ROLE=service_role run "…or pro"                                              "ALLOWED rows=1" "$(tier_is $P2 pro)"      "$BASE $UNSCOPED $(personal_tier pro)"
ROLE=service_role run "a playlist that doesn't exist is free"                "ALLOWED rows=1" "$(tier_is 00000000-0000-4000-8000-0000000000ff free)" ""
run "the tier is not the user's to read"                                     "DENIED"         "SELECT _export_tier_for_playlist($(d $P))" "$BASE"
ROLE=anon run "…nor anyone's signed out"                                     "DENIED"         "SELECT _export_tier_for_playlist($(d $P))" "$BASE"

DL_OLD="$(export_job $J1 done download 16:9 "$(keys_of "$(dl_key $J1)")" 8)"
DL_NEW="$(export_job $J2 done download 9:16 "$(keys_of "$(dl_key $J2)")" 6)"
ROLE=service_role run "an 8-day-old download is retired, its file queued"    "ALLOWED rows=1" "SELECT _render_jobs_retention(); $(queued "$(dl_key $J1)")" "$BASE $DL_OLD $DL_NEW"
ROLE=service_role run "…and its row gone"                                    "ALLOWED rows=0" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $DL_OLD $DL_NEW"
ROLE=service_role run "a 6-day-old download stays, and so does its file"     "ALLOWED rows=1" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J2) AND NOT EXISTS (SELECT 1 FROM game_video_deletions WHERE storage_key = $(d "$(dl_key $J2)"))" "$BASE $DL_OLD $DL_NEW"
SH_OLD="$(export_job $J1 done share 9:16 "$(keys_of "highlights/$U/$J1.mp4")" 31)"
SH_NEW="$(export_job $J2 done share 16:9 "$(keys_of "highlights/$U/$J2.mp4")" 20)"
ROLE=service_role run "a share job is kept its link's 30 days"               "ALLOWED rows=1" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J2)" "$BASE $SH_OLD $SH_NEW"
ROLE=service_role run "…then retired"                                        "ALLOWED rows=0" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM render_jobs WHERE id = $(d $J1)" "$BASE $SH_OLD $SH_NEW"
ROLE=service_role run "…queueing nothing: its files are the media bucket's"  "ALLOWED rows=0" "SELECT _render_jobs_retention(); SELECT count(*) AS n FROM game_video_deletions WHERE storage_key IN ($(d "highlights/$U/$J1.mp4"), $(d "highlights/$U/$J2.mp4"))" "$BASE $SH_OLD $SH_NEW"

run "deleting the playlist as its owner queues its download's file"          "ALLOWED rows=1" "DELETE FROM playlists WHERE id = $(d $P); RESET ROLE; $(queued "$(dl_key $J1)")" "$BASE $(export_job $J1 done download 16:9 "$(keys_of "$(dl_key $J1)")")"
run "…a running download's too (its renderer may have written it)"          "ALLOWED rows=1" "DELETE FROM playlists WHERE id = $(d $P); RESET ROLE; $(queued "$(dl_key $J1)")" "$BASE $(export_job $J1 running download 16:9 "$(keys_of "$(dl_key $J1)")")"
ROLE=service_role run "a finished download's result key counts as well"      "ALLOWED rows=1" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "$(dl_key $J1)")" "$BASE $(export_job $J1 done download 16:9) UPDATE render_jobs SET result = jsonb_build_object('key', $(d "$(dl_key $J1)")) WHERE id = $(d $J1);"
ROLE=service_role run "a download never taken has nothing to queue"          "ALLOWED rows=0" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "$(dl_key $J1)")" "$BASE $(export_job $J1 failed download 16:9)"
ROLE=service_role run "a share's file is never queued"                       "ALLOWED rows=0" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "highlights/$U/$J3.mp4")" "$BASE $(export_job $J1 done share 16:9 "$(keys_of "highlights/$U/$J3.mp4")")"
ROLE=service_role run "nor a game's copy named in a download's params"       "ALLOWED rows=0" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "$REF/games/$M/$J3.mp4")" "$BASE $(export_job $J1 done download 16:9 "$(keys_of "$REF/games/$M/$J3.mp4")")"
ROLE=service_role run "nor another job's download"                           "ALLOWED rows=0" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "$(dl_key $J2)")" "$BASE $(export_job $J1 done download 16:9 "$(keys_of "$(dl_key $J2)")")"
ROLE=service_role run "nor anything for a ship job"                          "ALLOWED rows=0" "DELETE FROM render_jobs WHERE id = $(d $J1); $(queued "$(dl_key $J1)")" "$BASE $(job $J1 done 'params' "$(d "$(keys_of "$(dl_key $J1)")")::jsonb")"
ROLE=service_role run "the queueing trigger is no client's to call"          "ALLOWED rows=0" "SELECT (has_function_privilege('authenticated', 'queue_render_job_export_deletion()', 'EXECUTE') OR has_function_privilege('anon', 'queue_render_job_export_deletion()', 'EXECUTE'))::int AS n" ""

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
