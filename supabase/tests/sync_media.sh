#!/usr/bin/env bash
#
# Checks for the game's sync on the web and superseded clip files
# (20261022100000).
#
# The tip-off: a manual set by the video's uploader always applies, a confirm
# never overrides a coach's own sync, and a copy without an anchor of its own
# keeps the game's reference event. Per-quarter syncs: the uploader writes the
# quarters (with breaksCut, the marks and the tip-off when given), the shape is
# checked entry by entry, a game without a sync is refused. Superseded clip
# files: whatever makes a playlist clip stop pointing at a file queues that
# file's key (the owner's clear, the function's re-cut), the queue takes clip
# keys only and no client reads or writes it, the purge sees a key as in use
# while any playlist clip or live ship job still points at it, and the nightly
# purge calls the function for each queue that holds anything.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261022100000_sync_and_media_cleanup.sql supabase/tests/sync_media.sh   # before db push
#   supabase/tests/sync_media.sh                                                                             # after
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler), because `db query --db-url` sends one prepared statement at a time
# and can't hold a BEGIN … ROLLBACK. The URL is never printed; its password is
# masked out of any output.
set -euo pipefail
trap 'echo "sync_media.sh: failed at line $LINENO" >&2' ERR

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

# U uploads the probe copies and owns the probe playlists, V is another signed-in user.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
echo "# U=$U (uploader, owner)  V=$V (someone else)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# The uploader may own real copies on the target (the founder's staging
# account does). Every probe starts from none, inside its own rolled-back
# transaction, so the cap trigger sees exactly the rows a probe sets up.
CLEAN="DELETE FROM game_videos WHERE uploaded_by = $(d $U);"

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS) | RAISES:<token> (guard) | BLOCKED (either) | ERR: (any other error)
  local out got st actor="${ACTOR:-$U}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $CLEAN ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
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
  printf "  %-66s expect=%-28s got=%-30s %s\n" "$1" "$2" "$got" "$st"
}

# Two throwaway games of U's: M with a browser copy C (anchored on the
# tip-off), M2 with a desktop copy D (no anchor of its own). The national-team
# league never counts against the import quota.
M=sync-media-probe-match
M2=sync-media-probe-match-2
C=00000000-0000-4000-8000-00000c5e0c01
D=00000000-0000-4000-8000-00000c5e0c02
TIP='2026-10-04T13:00:00.000Z'
MATCHES="INSERT INTO matches (id, user_id, title, league_id) VALUES ($(d $M), $(d $U), $(d 'sync probe'), 'sweden-national-men'), ($(d $M2), $(d $U), $(d 'sync probe 2'), 'sweden-national-men');"
BASE="$MATCHES"
copy_c() {  # $1=status $2=sync_status
  echo "INSERT INTO game_videos (id, match_id, uploaded_by, status, storage_key, origin, anchor_kind, anchor_real_world_time, sync_status, ready_at) VALUES ($(d $C), $(d $M), $(d $U), $(d $1), $(d "probe/games/$M/$C.mp4"), 'browser', 'tipoff', $(d $TIP), $(d $2), now());"
}
READY_C="$(copy_c ready not_found)"
DESKTOP_D="INSERT INTO game_videos (id, match_id, uploaded_by, status, storage_key, ready_at) VALUES ($(d $D), $(d $M2), $(d $U), 'ready', $(d "probe/games/$M2/$D.mp4"), now());"
FP='{"version":1,"durationMs":9350000,"offsetsS":[30,90],"hashes":["00ff00ff00ff00ff","0123456789abcdef"],"key":"0000000000000000000000000000000000000000000000000000000000000c5e"}'
FINGERPRINT_D="UPDATE game_videos SET content_fingerprint = $(d "$FP")::jsonb WHERE id = $(d $D);"
sync_of() {  # $1=match $2=sync point json
  echo "UPDATE matches SET sync_point = $(d "$2")::jsonb WHERE id = $(d $1);"
}
COACH='{"syncVideoTime": 100, "syncRealWorldTime": "2026-10-04T13:00:00.000Z"}'
COACH_LABELLED='{"syncVideoTime": 100, "syncRealWorldTime": "2026-10-04T13:00:00.000Z", "anchor": {"kind": "first_basket", "label": "the first basket"}}'
COACH_QUARTERS='{"syncVideoTime": 100, "syncRealWorldTime": "2026-10-04T13:00:00.000Z", "periods": {"3": {"syncVideoTime": 2000, "syncRealWorldTime": "2026-10-04T14:00:00Z"}}, "marks": {"2": {"anchor": {"realWorldTime": "2026-10-04T13:42:00Z", "kind": "period_start", "label": "Start of Q2"}}}}'
set_sync() {  # $1=video $2=status $3=seconds [$4=user]
  echo "SELECT _game_video_set_sync($(d $1), $(d ${4:-$U}), $(d $2), $3);"
}
sync_is() {  # $1=match, then a condition on sync_point
  echo "SELECT count(*) AS n FROM matches WHERE id = $(d $1) AND $2"
}

echo "== the tip-off (sync_set): the uploader's manual applies, a confirm keeps the lock"
ROLE=service_role run "manual over a coach's own sync applies"                  "ALLOWED rows=1"      "$(sync_is $M "(sync_point->>'syncVideoTime')::float = 341 AND sync_point->>'syncRealWorldTime' = '$TIP'")" "$BASE $(sync_of $M "$COACH") $READY_C $(set_sync $C manual 341)"
ROLE=service_role run "…and the row says manual"                                "ALLOWED rows=1"      "SELECT count(*) AS n FROM game_videos WHERE id = $(d $C) AND sync_status = 'manual'" "$BASE $(sync_of $M "$COACH") $READY_C $(set_sync $C manual 341)"
ROLE=service_role run "…and keeps the game's quarters and marks"                "ALLOWED rows=1"      "$(sync_is $M "sync_point->'periods'->'3' IS NOT NULL AND sync_point->'marks'->'2' IS NOT NULL AND (sync_point->>'syncVideoTime')::float = 341")" "$BASE $(sync_of $M "$COACH_QUARTERS") $READY_C $(set_sync $C manual 341)"
ROLE=service_role run "a confirm over a coach's own sync stays locked"          "RAISES:sync_locked"  "SELECT _game_video_set_sync($(d $C), $(d $U), 'confirmed', 341)" "$BASE $(sync_of $M "$COACH") $READY_C"
ROLE=service_role run "…unless the converter applied it"                        "ALLOWED rows=1"      "$(sync_is $M "(sync_point->>'syncVideoTime')::float = 341")" "$BASE $(sync_of $M "$COACH") $(copy_c ready applied) $(set_sync $C confirmed 341)"
ROLE=service_role run "a tip-off anchor drops a label left from another reference" "ALLOWED rows=1"   "$(sync_is $M "NOT (sync_point ? 'anchor') AND (sync_point->>'syncVideoTime')::float = 341")" "$BASE $(sync_of $M "$COACH_LABELLED") $READY_C $(set_sync $C manual 341)"
ROLE=service_role run "a desktop copy: manual moves only the video time"        "ALLOWED rows=1"      "$(sync_is $M2 "(sync_point->>'syncVideoTime')::float = 341 AND sync_point->>'syncRealWorldTime' = '$TIP' AND sync_point->'anchor'->>'kind' = 'first_basket'")" "$BASE $(sync_of $M2 "$COACH_LABELLED") $DESKTOP_D $(set_sync $D manual 341)"
ROLE=service_role run "…and leaves no hint (the reference isn't its tip-off)"   "ALLOWED rows=0"      "SELECT count(*) AS n FROM video_sync_hints WHERE detected_by = $(d $U) AND fingerprint_key = '0000000000000000000000000000000000000000000000000000000000000c5e'" "$BASE $(sync_of $M2 "$COACH") $DESKTOP_D $FINGERPRINT_D $(set_sync $D manual 341)"
ROLE=service_role run "a confirm on a desktop copy keeps the coach's sync locked" "RAISES:sync_locked" "SELECT _game_video_set_sync($(d $D), $(d $U), 'confirmed', 341)" "$BASE $(sync_of $M2 "$COACH") $DESKTOP_D"
ROLE=service_role run "a confirm on a copy without an anchor, the game unsynced" "RAISES:no_anchor"   "SELECT _game_video_set_sync($(d $D), $(d $U), 'confirmed', 341)" "$BASE $DESKTOP_D"
ROLE=service_role run "manual on a copy without an anchor, the game unsynced"   "RAISES:no_anchor"    "SELECT _game_video_set_sync($(d $D), $(d $U), 'manual', 341)" "$BASE $DESKTOP_D"
ROLE=service_role run "a time out of range"                                     "RAISES:invalid_request" "SELECT _game_video_set_sync($(d $C), $(d $U), 'manual', 'NaN'::float)" "$BASE $READY_C"
ROLE=service_role run "someone else's copy is not found"                        "RAISES:not_found"    "SELECT _game_video_set_sync($(d $C), $(d $V), 'manual', 341)" "$BASE $(sync_of $M "$COACH") $READY_C"
run "the helper is not the user's to call"                                      "DENIED"              "SELECT _game_video_set_sync($(d $C), $(d $U), 'manual', 341)" "$BASE $READY_C"

echo "== quarters (_game_video_set_periods)"
Q2='{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-10-04T13:42:00Z", "anchor": {"kind": "period_start", "label": "Start of Q2"}}}, "breaksCut": true}'
set_periods() {  # $1=video $2=payload json [$3=user]
  echo "SELECT _game_video_set_periods($(d $1), $(d ${3:-$U}), $(d "$2")::jsonb);"
}
refused() {  # $1=label $2=payload json: refused before anything is written
  ROLE=service_role run "$1" "RAISES:invalid_request" "$(set_periods $C "$2" | sed 's/;$//')" "$BASE $(sync_of $M "$COACH") $READY_C"
}
ROLE=service_role run "writes the quarter's own sync"                          "ALLOWED rows=1" "$(sync_is $M "(sync_point->'periods'->'2'->>'syncVideoTime')::float = 642 AND sync_point->'periods'->'2'->'anchor'->>'kind' = 'period_start'")" "$BASE $(sync_of $M "$COACH") $READY_C $(set_periods $C "$Q2")"
ROLE=service_role run "…keeps the tip-off and the marks, sets breaksCut"       "ALLOWED rows=1" "$(sync_is $M "(sync_point->>'syncVideoTime')::float = 100 AND sync_point->'marks'->'2' IS NOT NULL AND (sync_point->>'breaksCut')::boolean")" "$BASE $(sync_of $M "$COACH_QUARTERS") $READY_C $(set_periods $C "$Q2")"
ROLE=service_role run "…and replaces the quarters it doesn't name"            "ALLOWED rows=1" "$(sync_is $M "NOT (sync_point->'periods' ? '3')")" "$BASE $(sync_of $M "$COACH_QUARTERS") $READY_C $(set_periods $C "$Q2")"
ROLE=service_role run "an empty set clears the quarters"                       "ALLOWED rows=0" "$(sync_is $M "sync_point ? 'periods'")" "$BASE $(sync_of $M "$COACH_QUARTERS") $READY_C $(set_periods $C '{"periods": {}, "breaksCut": false}')"
ROLE=service_role run "…and breaksCut false is kept as the coach's answer"     "ALLOWED rows=1" "$(sync_is $M "sync_point->'breaksCut' = 'false'::jsonb")" "$BASE $(sync_of $M "$COACH_QUARTERS") $READY_C $(set_periods $C '{"periods": {}, "breaksCut": false}')"
ROLE=service_role run "the tip-off given with them is the uploader's manual"   "ALLOWED rows=1" "SELECT count(*) AS n FROM matches m JOIN game_videos g ON g.match_id = m.id WHERE m.id = $(d $M) AND (m.sync_point->>'syncVideoTime')::float = 120 AND m.sync_point->'periods'->'2' IS NOT NULL AND g.sync_status = 'manual'" "$BASE $(sync_of $M "$COACH") $READY_C $(set_periods $C '{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-10-04T13:42:00Z"}}, "syncVideoTime": 120}')"
ROLE=service_role run "fields it doesn't know are left out"                    "ALLOWED rows=0" "$(sync_is $M "sync_point->'periods'->'2' ? 'junk'")" "$BASE $(sync_of $M "$COACH") $READY_C $(set_periods $C '{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-10-04T13:42:00Z", "junk": 1}}}')"
ROLE=service_role run "it answers the sync point as written"                   "ALLOWED rows=1" "SELECT ((_game_video_set_periods($(d $C), $(d $U), $(d "$Q2")::jsonb)->'sync_point'->'periods'->'2'->>'syncVideoTime')::float = 642)::int AS n" "$BASE $(sync_of $M "$COACH") $READY_C"
refused "period 1 is the tip-off, not a quarter"      '{"periods": {"1": {"syncVideoTime": 5, "syncRealWorldTime": "2026-10-04T13:00:00Z"}}}'
refused "a period past OT4"                           '{"periods": {"9": {"syncVideoTime": 5, "syncRealWorldTime": "2026-10-04T15:00:00Z"}}}'
refused "a quarter before the video starts"           '{"periods": {"2": {"syncVideoTime": -1, "syncRealWorldTime": "2026-10-04T13:42:00Z"}}}'
refused "a quarter ten hours in"                      '{"periods": {"2": {"syncVideoTime": 36000, "syncRealWorldTime": "2026-10-04T13:42:00Z"}}}'
refused "a video time that isn't a number"            '{"periods": {"2": {"syncVideoTime": "642", "syncRealWorldTime": "2026-10-04T13:42:00Z"}}}'
refused "a time without a zone"                       '{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-10-04T13:42:00"}}}'
refused "a day the calendar hasn't"                   '{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-02-30T13:42:00Z"}}}'
refused "an anchor of an unknown kind"                '{"periods": {"2": {"syncVideoTime": 642, "syncRealWorldTime": "2026-10-04T13:42:00Z", "anchor": {"kind": "buzzer", "label": "x"}}}}'
refused "an anchor label over 200 characters"         "{\"periods\": {\"2\": {\"syncVideoTime\": 642, \"syncRealWorldTime\": \"2026-10-04T13:42:00Z\", \"anchor\": {\"kind\": \"play\", \"label\": \"$(printf 'x%.0s' {1..201})\"}}}}"
refused "periods that aren't an object"               '{"periods": [1, 2]}'
refused "a breaksCut that isn't a boolean"            '{"periods": {}, "breaksCut": "yes"}'
refused "a mark for period 0"                         '{"periods": {}, "marks": {"0": {"anchor": {"realWorldTime": "2026-10-04T13:00:00Z", "kind": "play", "label": "x"}}}}'
refused "a mark whose anchor has no time"             '{"periods": {}, "marks": {"2": {"anchor": {"kind": "play", "label": "x"}}}}'
refused "a tip-off that isn't a number"               '{"periods": {}, "syncVideoTime": "120"}'
ROLE=service_role run "a refused write changes nothing"                        "ALLOWED rows=1" "SELECT count(*) AS n FROM matches WHERE id = $(d $M) AND sync_point = $(d "$COACH")::jsonb" "$BASE $(sync_of $M "$COACH") $READY_C DO \$x\$ BEGIN PERFORM _game_video_set_periods($(d $C), $(d $U), '{\"periods\": {\"2\": {\"syncVideoTime\": 642, \"syncRealWorldTime\": \"2026-10-04T13:42:00Z\"}, \"3\": {\"syncVideoTime\": -5, \"syncRealWorldTime\": \"2026-10-04T14:00:00Z\"}}}'::jsonb); EXCEPTION WHEN OTHERS THEN NULL; END \$x\$;"
ROLE=service_role run "a game without a sync"                                  "RAISES:no_sync"        "$(set_periods $C "$Q2" | sed 's/;$//')" "$BASE $READY_C"
ROLE=service_role run "a copy still converting"                                "RAISES:wrong_status"   "$(set_periods $C "$Q2" | sed 's/;$//')" "$BASE $(sync_of $M "$COACH") $(copy_c converting pending)"
ROLE=service_role run "someone else's copy is not found"                       "RAISES:not_found"      "$(set_periods $C "$Q2" $V | sed 's/;$//')" "$BASE $(sync_of $M "$COACH") $READY_C"
run "not the user's to call"                                                   "DENIED"                "$(set_periods $C "$Q2" | sed 's/;$//')" "$BASE $(sync_of $M "$COACH") $READY_C"
ROLE=anon run "nor anyone's signed out"                                        "DENIED"                "$(set_periods $C "$Q2" | sed 's/;$//')" "$BASE $(sync_of $M "$COACH") $READY_C"

echo "== superseded clip files: the queue"
PL=00000000-0000-4000-8000-00000c5e0a01
PL2=00000000-0000-4000-8000-00000c5e0a02
J=00000000-0000-4000-8000-00000c5e0e01
BASE_URL=https://pub-probe.r2.dev
KEY="clips/$M/42_pre10.0_post3.0_s120.0.mp4"
NEW_KEY="clips/$M/42_pre10.0_post3.0_s121.0.mp4"
SMOKE_KEY="clips/smoke-probe/42_pre10.0_post3.0_s120.0.mp4"
PLAYLISTS="INSERT INTO playlists (id, user_id, name) VALUES ($(d $PL), $(d $U), $(d 'media probe')), ($(d $PL2), $(d $U), $(d 'media probe 2'));"
clip_in() {  # $1=playlist $2=url (or NULL)
  local url="NULL"; [[ "$2" != NULL ]] && url="$(d "$2")"
  echo "INSERT INTO playlist_clips (playlist_id, match_id, event_id, position, item_type, r2_url) VALUES ($(d $1), $(d $M), 42, 0, 'clip', $url);"
}
SHIPPED="$PLAYLISTS $(clip_in $PL "$BASE_URL/$KEY")"
set_url() {  # $1=playlist $2=url (or NULL)
  local url="NULL"; [[ "$2" != NULL ]] && url="$(d "$2")"
  echo "UPDATE playlist_clips SET r2_url = $url WHERE playlist_id = $(d $1)"
}
queued() {  # $1=key [$2=reason]
  echo "SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d "$1")${2:+ AND reason = $(d $2)}"
}
QUEUE_KEY="SELECT _queue_media_deletion($(d "$KEY"), 'cleared');"
run "the owner clearing a shipped clip queues its file"                        "ALLOWED rows=1" "$(set_url $PL NULL); RESET ROLE; $(queued "$KEY" cleared)" "$BASE $SHIPPED"
ROLE=service_role run "a re-cut queues the file it replaces"                   "ALLOWED rows=1" "$(set_url $PL "$BASE_URL/$NEW_KEY"); $(queued "$KEY" replaced)" "$BASE $SHIPPED"
ROLE=service_role run "…never the new one"                                     "ALLOWED rows=0" "$(set_url $PL "$BASE_URL/$NEW_KEY"); $(queued "$NEW_KEY")" "$BASE $SHIPPED"
ROLE=service_role run "the same URL again queues nothing"                      "ALLOWED rows=0" "$(set_url $PL "$BASE_URL/$KEY"); $(queued "$KEY")" "$BASE $SHIPPED"
ROLE=service_role run "the same key from another base queues nothing"          "ALLOWED rows=0" "$(set_url $PL "https://media.example/$KEY"); $(queued "$KEY")" "$BASE $SHIPPED"
ROLE=service_role run "a first cut queues nothing"                             "ALLOWED rows=0" "$(set_url $PL "$BASE_URL/$KEY"); SELECT count(*) AS n FROM media_deletions WHERE storage_key LIKE 'clips/$M/%'" "$BASE $PLAYLISTS $(clip_in $PL NULL)"
ROLE=service_role run "a URL that isn't a clip's queues nothing"               "ALLOWED rows=0" "$(set_url $PL NULL); SELECT count(*) AS n FROM media_deletions WHERE storage_key LIKE '%probe%'" "$BASE $PLAYLISTS $(clip_in $PL "$BASE_URL/highlights/$U/$PL.mp4")"
ROLE=service_role run "deleting a clip's row queues nothing"                   "ALLOWED rows=0" "DELETE FROM playlist_clips WHERE playlist_id = $(d $PL); $(queued "$KEY")" "$BASE $SHIPPED"
ROLE=service_role run "the key is read off the end of the URL's path"          "ALLOWED rows=1" "SELECT (_media_clip_key($(d "https://pub-x.r2.dev/a/b/clips/$M/42_pre-2.0_post3.0.mp4")) = $(d "clips/$M/42_pre-2.0_post3.0.mp4"))::int AS n" ""
ROLE=service_role run "…and nothing off a URL with a query string"             "ALLOWED rows=1" "SELECT (_media_clip_key($(d "$BASE_URL/$KEY?v=2")) IS NULL)::int AS n" ""
ROLE=service_role run "a key queued twice is one entry"                        "ALLOWED rows=1" "SELECT _queue_media_deletion($(d "$KEY"), 'replaced'); $(queued "$KEY" cleared)" "$BASE $QUEUE_KEY"
ROLE=service_role run "only clip keys are queued"                              "ALLOWED rows=0" "SELECT _queue_media_deletion($(d "highlights/$U/$PL.mp4"), 'cleared'); SELECT count(*) AS n FROM media_deletions WHERE storage_key LIKE 'highlights/%'" ""
ROLE=service_role run "the queue refuses any other key outright"               "ERR:"           "INSERT INTO media_deletions (storage_key, reason) VALUES ($(d "probe/games/$M/$C.mp4"), 'cleared')" ""
run "the owner can't read the queue"                                           "DENIED"         "SELECT count(*) AS n FROM media_deletions" "$BASE $QUEUE_KEY"
run "…nor write to it"                                                         "DENIED"         "INSERT INTO media_deletions (storage_key, reason) VALUES ($(d "$KEY"), 'cleared')" ""
run "queueing is no client's to call"                                          "DENIED"         "SELECT _queue_media_deletion($(d "$KEY"), 'cleared')" ""
ROLE=anon run "…nor anyone's signed out"                                       "DENIED"         "SELECT _queue_media_deletion($(d "$KEY"), 'cleared')" ""
ROLE=service_role run "the trigger and key helpers are no client's to call"    "ALLOWED rows=0" "SELECT (has_function_privilege('authenticated', 'queue_superseded_clip_file()', 'EXECUTE') OR has_function_privilege('anon', 'queue_superseded_clip_file()', 'EXECUTE') OR has_function_privilege('authenticated', '_media_clip_key(text)', 'EXECUTE') OR has_function_privilege('anon', '_media_clip_key(text)', 'EXECUTE'))::int AS n" ""

echo "== the purge's view of the queue"
ROLE=service_role run "the due list holds a queued key in the scope"           "ALLOWED rows=1" "SELECT count(*) AS n FROM _media_deletions_due(100, 'clips/') WHERE storage_key = $(d "$KEY")" "$BASE $QUEUE_KEY"
ROLE=service_role run "…not one outside it (the smoke scope)"                  "ALLOWED rows=0" "SELECT count(*) AS n FROM _media_deletions_due(100, 'clips/smoke-') WHERE storage_key = $(d "$KEY")" "$BASE $QUEUE_KEY"
ROLE=service_role run "a smoke game's key is in the smoke scope"               "ALLOWED rows=1" "SELECT count(*) AS n FROM _media_deletions_due(100, 'clips/smoke-') WHERE storage_key = $(d "$SMOKE_KEY")" "SELECT _queue_media_deletion($(d "$SMOKE_KEY"), 'cleared');"
ROLE=service_role run "a file another playlist still uses is in use"           "ALLOWED rows=1" "$(set_url $PL NULL); SELECT _media_key_referenced($(d "$KEY"))::int AS n" "$BASE $SHIPPED $(clip_in $PL2 "$BASE_URL/$KEY")"
ROLE=service_role run "…also under another base"                               "ALLOWED rows=1" "$(set_url $PL NULL); SELECT _media_key_referenced($(d "$KEY"))::int AS n" "$BASE $SHIPPED $(clip_in $PL2 "https://media.example/$KEY")"
ROLE=service_role run "…until nothing points at it"                            "ALLOWED rows=0" "$(set_url $PL NULL); $(set_url $PL2 NULL); SELECT _media_key_referenced($(d "$KEY"))::int AS n" "$BASE $SHIPPED $(clip_in $PL2 "$BASE_URL/$KEY")"
ROLE=service_role run "a live ship job about to write it counts"               "ALLOWED rows=1" "SELECT _media_key_referenced($(d "$KEY"))::int AS n" "$BASE $PLAYLISTS INSERT INTO render_jobs (id, kind, playlist_id, user_id, status, params) VALUES ($(d $J), 'ship', $(d $PL), $(d $U), 'running', jsonb_build_object('clips', jsonb_build_array(jsonb_build_object('key', $(d "$KEY")))));"
ROLE=service_role run "…a finished one doesn't"                                "ALLOWED rows=0" "SELECT _media_key_referenced($(d "$KEY"))::int AS n" "$BASE $PLAYLISTS INSERT INTO render_jobs (id, kind, playlist_id, user_id, status, params) VALUES ($(d $J), 'ship', $(d $PL), $(d $U), 'done', jsonb_build_object('clips', jsonb_build_array(jsonb_build_object('key', $(d "$KEY")))));"
run "the due list is no client's to read"                                      "DENIED"         "SELECT count(*) AS n FROM _media_deletions_due(100, 'clips/')" ""
run "…nor is the reference check"                                              "DENIED"         "SELECT _media_key_referenced($(d "$KEY"))" ""

echo "== the nightly purge's gate"
QUIET="DELETE FROM game_video_deletions; DELETE FROM media_deletions;"
calls() {  # $1=the action in the body
  echo "SELECT LEAST(count(*), 1) AS n FROM net.http_request_queue WHERE url LIKE '%/game-video' AND convert_from(body, 'utf8') LIKE '%\"$1\"%'"
}
ROLE=service_role run "a queued clip file makes it call media_purge"           "ALLOWED rows=1" "SELECT run_game_video_purge(); RESET ROLE; $(calls media_purge)" "$QUIET $QUEUE_KEY"
ROLE=service_role run "…and not purge, with that queue empty"                  "ALLOWED rows=0" "SELECT run_game_video_purge(); RESET ROLE; $(calls purge)" "$QUIET $QUEUE_KEY"
ROLE=service_role run "a queued copy still makes it call purge"                "ALLOWED rows=1" "SELECT run_game_video_purge(); RESET ROLE; $(calls purge)" "$QUIET INSERT INTO game_video_deletions (storage_key) VALUES ($(d "probe/games/$M/$C.mp4"));"
ROLE=service_role run "with both queues empty it stays quiet"                  "ALLOWED rows=0" "SELECT run_game_video_purge(); RESET ROLE; SELECT LEAST(count(*), 1) AS n FROM net.http_request_queue WHERE url LIKE '%/game-video' AND convert_from(body, 'utf8') LIKE '%purge%'" "$QUIET"
run "the purge is not the user's to run"                                       "DENIED"         "SELECT run_game_video_purge()" ""

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
