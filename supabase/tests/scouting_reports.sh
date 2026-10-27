#!/usr/bin/env bash
#
# Checks for scouting reports (20261029100000).
#
# Player items: a 'player' playlist item is refused since 20261101100000 (the
# report is a draft per playlist; scouting_report_drafts.sh); a text item may
# still carry a stats card, a clip may not, reorder_playlist_items moves a text
# item. Publishing (20261102100000): open to every plan; a free plan may share
# ONE live report at a time (a second is refused and names the first, and
# scouting_report_share_limit tells the share sheet beforehand); only the
# playlist's owner, only with content of the right shape (version, section and
# clip counts, clip and poster key shapes, poster files of the caller's own); a
# second publish updates the same row (same link, a fresh 30 days). Reading:
# the table is the owner's to read and nobody's to write; the page's anonymous
# doors are get_scouting_report, which says valid, expired, revoked or not
# found, and record_scouting_report_open, which counts a reader's open of a live
# report (never of an ended one, nor the owner's own while signed in). Revoking wipes the content and queues the clip
# files for the purge; the service role can take any report down the same way
# (_take_down_scouting_report); deleting the playlist revokes; the sweep deletes
# rows a week past their end. (Which files the purge may delete,
# _media_key_referenced, comes with the purge on feat/cloud-game-videos.)
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. The signed-in probes need a user U with a personal space (RLS_TEST_USER,
# default the founder's staging account) and one other user.
#
#   SUPABASE_DB_URL=<session pooler url> supabase/tests/scouting_reports.sh
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/<file>.sql supabase/tests/scouting_reports.sh   # a migration applied inside every probe
set -euo pipefail
trap 'echo "scouting_reports.sh: failed at line $LINENO" >&2' ERR

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

q1() {  # first column of the first row of a privileged query
  "$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -c "$1" </dev/null 2>/dev/null | head -1 | cut -d'|' -f1
}

# One probe transaction: the errors (with SQLSTATEs, so "P0001: token" and
# "42501" appear) followed by a `"n": <value>` line built from the last row the
# probe printed.
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

# U owns the probe playlists, V is another signed-in user.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
echo "# U=$U (owner)  V=$V (someone else)"
HAS_PERSONAL="$(q1 "SELECT count(*) FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.is_personal WHERE m.user_id = \$\$$U\$\$")"
if [[ "${HAS_PERSONAL:-0}" == "0" ]]; then echo "U has no personal space on this target; set RLS_TEST_USER to a user that has one." >&2; exit 1; fi

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS / privilege) | RAISES:<token> | ERR (any other error)
  local out got st actor="${ACTOR:-$U}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q 'ERROR:' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1 || true)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-70s expect=%-24s got=%-26s %s\n" "$1" "$2" "$got" "$st"
}

PL=00000000-0000-4000-8000-00000c5c0d01   # a throwaway playlist owned by U
R=00000000-0000-4000-8000-00000c5c0e01    # a throwaway report
CK1=clips/probe-m/1_pre10.0_post3.0_s100.0.mp4
CK2=clips/probe-m/2_pre10.0_post3.0_s100.0.mp4
POSTER="highlights/$U/00000000-0000-4000-8000-00000c5a0001.jpg"
OTHER_POSTER="highlights/$V/00000000-0000-4000-8000-00000c5a0002.jpg"

MAKE_PLAYLIST="INSERT INTO playlists (id, user_id, name) VALUES ($(d $PL), $(d $U), $(d 'scouting probe'));"
# The playlist has no club, so its plan is its owner's personal space's.
tier() { echo "UPDATE organizations SET plan_tier = '$1' WHERE id IN (SELECT m.org_id FROM org_memberships m JOIN organizations o ON o.id = m.org_id AND o.is_personal WHERE m.user_id = $(d $U));"; }
PRO="$MAKE_PLAYLIST $(tier pro)"
# On a free plan U's other live reports count against the one allowed, and U's
# account on a shared target may hold real ones: switch them off inside the probe.
ALONE="UPDATE scouting_reports SET revoked_at = now() WHERE user_id = $(d $U) AND revoked_at IS NULL;"
FREE="$MAKE_PLAYLIST $(tier free) $ALONE"

block() { printf '{"kind":"clip","id":"c1","clipKey":"%s","posterKey":%s,"label":"3PT Made","type":"3pt","subType":"","made":true,"period":"Q2","clock":"04:31","game":null,"note":null,"labels":[]}' "$1" "$2"; }
content() {  # $1=blocks, comma separated
  printf '{"v":1,"header":{"title":"T","opponent":null,"preparedAt":"2026-10-20T12:00:00Z","players":1,"clips":1,"attribution":true},"sections":[{"id":"p1","kind":"player","player":{"id":"1","name":"Alva Berg","number":"7","teamName":"X"},"note":"n","stats":null,"blocks":[%s]}]}' "$1"
}
GOOD="$(content "$(block "$CK1" "\"$POSTER\"")")"
publish() {  # $1=content json  [$2=title]
  echo "publish_scouting_report($(d $PL), $(d "${2:-AIK scouting}"), $(d "$1")::jsonb, $(d key-1))"
}
publish_expr() {  # $1=a SQL jsonb expression
  echo "publish_scouting_report($(d $PL), $(d 'AIK scouting'), $1, $(d key-1))"
}

# A stored report (privileged setup), with its state.
report_row() {  # $1=expires_at sql  $2=revoked_at sql  [$3=clip keys sql array]
  echo "INSERT INTO scouting_reports (id, user_id, playlist_id, title, content, content_key, clip_keys, expires_at, revoked_at) VALUES ($(d $R), $(d $U), $(d $PL), $(d 'AIK scouting'), $(d "$GOOD")::jsonb, $(d key-1), ${3:-ARRAY[$(d $CK1)]}::text[], $1, $2);"
}
LIVE="$(report_row "now() + interval '10 days'" NULL)"

# A second playlist of U's with a report of its own, and the clubs that move
# a playlist off U's personal space's plan (the pattern of player_passes.sh).
PL2=00000000-0000-4000-8000-00000c5c0d02
R2=00000000-0000-4000-8000-00000c5c0e02
K=00000000-0000-4000-8000-00000c5c0f01
MAKE_PL2="INSERT INTO playlists (id, user_id, name) VALUES ($(d $PL2), $(d $U), $(d 'scouting probe 2'));"
other_report() {  # $1=expires_at sql  $2=revoked_at sql
  echo "INSERT INTO scouting_reports (id, user_id, playlist_id, title, content, content_key, clip_keys, expires_at, revoked_at) VALUES ($(d $R2), $(d $U), $(d $PL2), $(d 'Other scouting'), $(d "$GOOD")::jsonb, $(d key-2), ARRAY[$(d $CK2)]::text[], $1, $2);"
}
OTHER_LIVE="$(other_report "now() + interval '10 days'" NULL)"
CLUB_PL2="INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d franchise)); UPDATE playlists SET org_id = $(d $K) WHERE id = $(d $PL2);"
CLUB_PL="INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d franchise)); UPDATE playlists SET org_id = $(d $K) WHERE id = $(d $PL);"

CARD='{"type":"player","v":1,"player":{"id":"1","name":"Probe","number":"7","teamId":null,"teamName":"X"},"note":"","stats":null}'
insert_item() {  # $1=item_type  $2=card sql
  echo "WITH x AS (INSERT INTO playlist_clips (playlist_id, item_type, item_id, match_id, event_id, text_content, duration_seconds, position, card) VALUES ($(d $PL), '$1', 'probe-new', $( [[ $1 == clip ]] && echo "$(d no-such-match), 1" || echo "NULL, NULL" ), 'Probe', NULL, 1, $2) RETURNING 1) SELECT count(*) AS n FROM x"
}

echo "== player items (refused since 20261101100000: the report is a draft)"
run "a player item with a player card"            "ERR"            "$(insert_item player "$(d "$CARD")::jsonb")" "$MAKE_PLAYLIST"
run "a player item with no card"                  "ERR"            "$(insert_item player NULL)" "$MAKE_PLAYLIST"
run "a player item with a stats card"             "ERR"            "$(insert_item player "$(d '{"type":"stats","v":1}')::jsonb")" "$MAKE_PLAYLIST"
run "a clip row with a player card"               "ERR"            "$(insert_item clip "$(d "$CARD")::jsonb")" "$MAKE_PLAYLIST"
run "a text item with a stats card still works"   "ALLOWED rows=1" "$(insert_item text "$(d '{"type":"stats","v":1}')::jsonb")" "$MAKE_PLAYLIST"
run "a plain text item still works"               "ALLOWED rows=1" "$(insert_item text NULL)" "$MAKE_PLAYLIST"
TEXT_ROW="INSERT INTO playlist_clips (playlist_id, item_type, item_id, text_content, position) VALUES ($(d $PL), 'text', 'probe-text', 'Probe', 0);"
run "reordering moves a text item"                "ALLOWED rows=1" "SELECT reorder_playlist_items($(d $PL), '[{\"item_type\":\"text\",\"item_id\":\"probe-text\",\"position\":5,\"group_id\":null}]'::jsonb); SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $PL) AND item_id = 'probe-text' AND position = 5" "$MAKE_PLAYLIST $TEXT_ROW"
ACTOR="$V" run "someone else can't reorder it"    "RAISES:not_owner" "SELECT reorder_playlist_items($(d $PL), '[]'::jsonb)" "$MAKE_PLAYLIST $TEXT_ROW"

echo "== publishing"
run "the owner on a paid plan publishes"          "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$PRO"
run "…a second publish updates the same row"      "ALLOWED rows=1" "SELECT $(publish "$GOOD"); SELECT $(publish "$GOOD" 'AIK scouting 2'); SELECT count(*) AS n FROM scouting_reports WHERE playlist_id = $(d $PL) AND revoked_at IS NULL AND title = 'AIK scouting 2'" "$PRO"
run "…and the same link gets a fresh 30 days"     "ALLOWED rows=1" "SELECT $(publish "$GOOD"); RESET ROLE; UPDATE scouting_reports SET expires_at = now() + interval '1 day' WHERE playlist_id = $(d $PL); SET LOCAL ROLE authenticated; SELECT $(publish "$GOOD"); SELECT count(*) AS n FROM scouting_reports WHERE playlist_id = $(d $PL) AND expires_at > now() + interval '29 days'" "$PRO"
run "the clip keys come from the content"         "ALLOWED rows=1" "SELECT $(publish "$GOOD"); SELECT count(*) AS n FROM scouting_reports WHERE playlist_id = $(d $PL) AND clip_keys = ARRAY[$(d $CK1)]" "$PRO"
ACTOR="$V" run "someone else's playlist is refused" "RAISES:not_owner" "SELECT $(publish "$GOOD")" "$PRO"
ROLE=anon run "anon can't publish"                "DENIED"         "SELECT $(publish "$GOOD")" "$PRO"

echo "== publishing: the one free report"
run "a free plan publishes its first report"      "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$FREE"
run "…not while another live report is shared from a free plan" "RAISES:report_limit_reached" "SELECT $(publish "$GOOD")" "$FREE $MAKE_PL2 $OTHER_LIVE"
# A bought single game opens export (_has_paid) but the report limit reads only the plan.
BOUGHT_SINGLE="INSERT INTO purchases (user_id, kind, source) VALUES ($(d $U), $(d single_game), $(d admin));"
run "a single-game buyer is still limited"        "RAISES:report_limit_reached" "SELECT $(publish "$GOOD")" "$FREE $BOUGHT_SINGLE $MAKE_PL2 $OTHER_LIVE"
run "…and the refusal names that report"          "ALLOWED rows=1" "DO \$probe\$ DECLARE d text; BEGIN
  PERFORM $(publish "$GOOD");
EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  PERFORM set_config('probe.detail', d, true);
END \$probe\$;
SELECT (current_setting('probe.detail')::jsonb->>'id' = $(d $R2))::int AS n" "$FREE $MAKE_PL2 $OTHER_LIVE"
run "an expired report elsewhere doesn't count"   "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$FREE $MAKE_PL2 $(other_report "now() - interval '1 day'" NULL)"
run "a stopped report elsewhere doesn't count"    "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$FREE $MAKE_PL2 $(other_report "now() + interval '10 days'" 'now()')"
run "updating the same playlist's live report is allowed" "ALLOWED rows=1" "SELECT ((($(publish "$GOOD"))->>'created') = 'false')::int AS n" "$FREE $LIVE"
run "a lapsed Pro can't update one of two live reports" "RAISES:report_limit_reached" "SELECT $(publish "$GOOD")" "$FREE $LIVE $MAKE_PL2 $OTHER_LIVE"
run "a report shared from a club doesn't count"   "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$FREE $MAKE_PL2 $CLUB_PL2 $OTHER_LIVE"
run "a club playlist publishes while a free report is live" "ALLOWED rows=1" "SELECT (($(publish "$GOOD"))->>'created')::boolean::int AS n" "$FREE $CLUB_PL $MAKE_PL2 $OTHER_LIVE"

echo "== the share sheet's check"
run "a free plan with nothing shared: limited, nothing blocks" "ALLOWED rows=1" "SELECT (r->>'limited' = 'true' AND r->'blocked_by' = 'null'::jsonb)::int AS n FROM (SELECT scouting_report_share_limit($(d $PL)) AS r) x" "$FREE"
run "a paid plan isn't limited"                   "ALLOWED rows=1" "SELECT (r->>'limited' = 'false')::int AS n FROM (SELECT scouting_report_share_limit($(d $PL)) AS r) x" "$PRO"
run "it names the live report that blocks"        "ALLOWED rows=1" "SELECT (r->'blocked_by'->>'id' = $(d $R2))::int AS n FROM (SELECT scouting_report_share_limit($(d $PL)) AS r) x" "$FREE $MAKE_PL2 $OTHER_LIVE"
ACTOR="$V" run "someone else's playlist is refused" "RAISES:not_owner" "SELECT scouting_report_share_limit($(d $PL))" "$FREE"
ROLE=anon run "anon can't ask"                    "DENIED"         "SELECT scouting_report_share_limit($(d $PL))" "$FREE"

echo "== what a report may hold"
bad() {  # $1=label  $2=content sql expression
  run "$1" "RAISES:invalid_content" "SELECT $(publish_expr "$2")" "$PRO"
}
bad "version 2"                       "$(d "$(echo "$GOOD" | sed 's/"v":1/"v":2/')")::jsonb"
bad "no sections"                     "($(d "$GOOD")::jsonb - 'sections')"
bad "sections that aren't an array"   "jsonb_set($(d "$GOOD")::jsonb, '{sections}', '{}'::jsonb)"
bad "a section without blocks"        "jsonb_set($(d "$GOOD")::jsonb, '{sections,0,blocks}', '5'::jsonb)"
bad "a clip key that isn't a clip"    "$(d "$(content "$(block clips/x/../y.mp4 null)")")::jsonb"
bad "a clip key under another prefix" "$(d "$(content "$(block highlights/a/b.mp4 null)")")::jsonb"
bad "a clip block with no key"        "$(d "$(content '{"kind":"clip"}')")::jsonb"
bad "another user's poster"           "$(d "$(content "$(block "$CK1" "\"$OTHER_POSTER\"")")")::jsonb"
bad "a poster that isn't a jpg"       "$(d "$(content "$(block "$CK1" "\"highlights/$U/00000000-0000-4000-8000-00000c5a0003.mp4\"")")")::jsonb"
bad "a poster that isn't a string"    "$(d "$(content "$(block "$CK1" 5)")")::jsonb"
bad "301 clips"                       "jsonb_set($(d "$GOOD")::jsonb, '{sections,0,blocks}', (SELECT jsonb_agg($(d "$(block "$CK1" null)")::jsonb) FROM generate_series(1,301)))"
bad "61 sections"                     "jsonb_set($(d "$GOOD")::jsonb, '{sections}', (SELECT jsonb_agg($(d '{"id":"p","kind":"player","blocks":[]}')::jsonb) FROM generate_series(1,61)))"
bad "content over 256 KB"             "jsonb_set($(d "$GOOD")::jsonb, '{header,pad}', to_jsonb(repeat('x',270000)))"
run "300 clips are fine"              "ALLOWED rows=1" "SELECT (($(publish_expr "jsonb_set($(d "$GOOD")::jsonb, '{sections,0,blocks}', (SELECT jsonb_agg($(d "$(block "$CK1" null)")::jsonb) FROM generate_series(1,300)))"))->>'created')::boolean::int AS n" "$PRO"
run "an empty title"                  "RAISES:invalid_content" "SELECT $(publish "$GOOD" '   ')" "$PRO"
run "a poster of the caller's own, or none, is fine" "ALLOWED rows=1" "SELECT (($(publish "$(content "$(block "$CK1" null),$(block "$CK2" "\"$POSTER\"")")"))->>'created')::boolean::int AS n" "$PRO"

echo "== reading"
run "the owner reads their own row"               "ALLOWED rows=1" "SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
ACTOR="$V" run "someone else reads none"          "ALLOWED rows=0" "SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "anon can't read the table"         "DENIED"         "SELECT count(*) AS n FROM scouting_reports" "$MAKE_PLAYLIST $LIVE"
run "the owner can't write the table"             "DENIED"         "UPDATE scouting_reports SET title = 'x' WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
run "…nor insert"                                 "DENIED"         "INSERT INTO scouting_reports (user_id, title, content, content_key) VALUES ($(d $U), 'x', '{}'::jsonb, 'k')" "$MAKE_PLAYLIST"
run "…nor delete"                                 "DENIED"         "DELETE FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
page() {  # $1=condition on the answer
  echo "SELECT (get_scouting_report($(d $R))->>'valid' = 'true')::int AS n"
}
ROLE=anon run "anon opens a live report"          "ALLOWED rows=1" "$(page)" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "…and gets its content"             "ALLOWED rows=1" "SELECT (get_scouting_report($(d $R))->'content'->'sections'->0->>'id' = 'p1')::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "…and nothing about its owner"      "ALLOWED rows=1" "SELECT (NOT (get_scouting_report($(d $R)) ?| ARRAY['user_id','playlist_id','clip_keys','open_count']))::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "an expired report says so"         "ALLOWED rows=1" "SELECT (get_scouting_report($(d $R))->>'reason' = 'expired')::int AS n" "$MAKE_PLAYLIST $(report_row "now() - interval '1 day'" NULL)"
ROLE=anon run "a revoked report says so"          "ALLOWED rows=1" "SELECT (get_scouting_report($(d $R))->>'reason' = 'revoked')::int AS n" "$MAKE_PLAYLIST $(report_row "now() + interval '10 days'" 'now()')"
ROLE=anon run "an unknown id says not found"      "ALLOWED rows=1" "SELECT (get_scouting_report(gen_random_uuid())->>'reason' = 'not_found')::int AS n" ""

echo "== reader counts"
opens() {  # $1=report id  -> count an open as the caller, then read the counter privileged
  echo "SELECT record_scouting_report_open($(d $1)); RESET ROLE; SELECT open_count AS n FROM scouting_reports WHERE id = $(d $1)"
}
ROLE=anon run "anon counts an open of a live report"  "ALLOWED rows=1" "$(opens $R)" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "…not of an expired one"                "ALLOWED rows=0" "$(opens $R)" "$MAKE_PLAYLIST $(report_row "now() - interval '1 day'" NULL)"
ROLE=anon run "…nor of a stopped one"                 "ALLOWED rows=0" "$(opens $R)" "$MAKE_PLAYLIST $(report_row "now() + interval '10 days'" 'now()')"
run "…but the owner's own open isn't counted"          "ALLOWED rows=0" "$(opens $R)" "$MAKE_PLAYLIST $LIVE"
# The report's updated_at is its "up to date": set a week back and held, so an open that touched it would show.
HOLD_UPDATED_AT="UPDATE scouting_reports SET updated_at = now() - interval '7 days' WHERE id = $(d $R); SELECT set_config('probe.updated_at', (SELECT updated_at::text FROM scouting_reports WHERE id = $(d $R)), true);"
ROLE=anon run "…and doesn't touch updated_at"         "ALLOWED rows=1" "SELECT record_scouting_report_open($(d $R)); RESET ROLE; SELECT (updated_at = current_setting('probe.updated_at')::timestamptz AND open_count = 1)::int AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE $HOLD_UPDATED_AT"
ROLE=anon run "an unknown id is ignored"              "ALLOWED rows=1" "SELECT record_scouting_report_open(gen_random_uuid()); SELECT 1 AS n" ""
run "updating the report keeps its count"             "ALLOWED rows=5" "RESET ROLE; UPDATE scouting_reports SET open_count = 5 WHERE id = $(d $R); SET LOCAL ROLE authenticated; SELECT $(publish "$GOOD"); SELECT open_count AS n FROM scouting_reports WHERE id = $(d $R)" "$PRO $LIVE"

echo "== revoking"
run "the owner revokes: the content is wiped"    "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL AND content = '{}'::jsonb AND clip_keys = '{}'" "$MAKE_PLAYLIST $LIVE"
run "…and its clip file is queued for the purge"  "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); RESET ROLE; SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d $CK1)" "$MAKE_PLAYLIST $LIVE"
run "revoking twice is a no-op"                   "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT revoke_scouting_report($(d $R)); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL" "$MAKE_PLAYLIST $LIVE"
ACTOR="$V" run "someone else can't revoke it"     "RAISES:not_found" "SELECT revoke_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "anon can't revoke"                 "DENIED"         "SELECT revoke_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
run "publishing after a revoke makes a new link"  "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT (($(publish "$GOOD"))->>'id' <> $(d $R))::int AS n" "$PRO $LIVE"

echo "== taking a report down (the service role only)"
run "the owner can't call the takedown"           "DENIED"         "SELECT _take_down_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "anon can't either"                 "DENIED"         "SELECT _take_down_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "the service role takes down anyone's report: content wiped" "ALLOWED rows=1" "SELECT set_config('probe.r', _take_down_scouting_report($(d $R)), true); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND current_setting('probe.r') = 'taken_down' AND revoked_at IS NOT NULL AND content = '{}'::jsonb AND clip_keys = '{}'" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "…the page says it's no longer shared"       "ALLOWED rows=1" "SELECT _take_down_scouting_report($(d $R)); SELECT (get_scouting_report($(d $R))->>'reason' = 'revoked')::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "…its clip file is queued for the purge"     "ALLOWED rows=1" "SELECT _take_down_scouting_report($(d $R)); SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d $CK1)" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "…and twice says already off"                "ALLOWED rows=1" "SELECT _take_down_scouting_report($(d $R)); SELECT (_take_down_scouting_report($(d $R)) = 'already_off')::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "…an unknown id says not found"              "ALLOWED rows=1" "SELECT (_take_down_scouting_report(gen_random_uuid()) = 'not_found')::int AS n" ""

echo "== a deleted playlist, and the sweep"
run "deleting the playlist revokes its report"    "ALLOWED rows=1" "DELETE FROM playlists WHERE id = $(d $PL); RESET ROLE; SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL AND content = '{}'::jsonb AND playlist_id IS NULL" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "the sweep deletes a row a week past expiry" "ALLOWED rows=1" "SELECT (run_scouting_report_sweep() >= 1)::int AS n" "$MAKE_PLAYLIST $(report_row "now() - interval '8 days'" NULL)"
ROLE=service_role run "…and queues its clip file"                  "ALLOWED rows=1" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d $CK1)" "$MAKE_PLAYLIST $(report_row "now() - interval '8 days'" NULL)"
ROLE=service_role run "…but leaves a live one"                     "ALLOWED rows=1" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
run "the sweep isn't the user's to call"          "DENIED"         "SELECT run_scouting_report_sweep()" ""

echo "== a kept report (the sample; 20261103100000)"
KEEP="SELECT _keep_scouting_report($(d $R), true);"
ROLE=service_role run "keeping a live report answers kept"            "ALLOWED rows=1" "SELECT (_keep_scouting_report($(d $R), true) = 'kept')::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "…and its expiry is infinity"                   "ALLOWED rows=1" "SELECT (expires_at = 'infinity')::int AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE $KEEP"
run "publishing the kept report again keeps infinity"                 "ALLOWED rows=1" "SELECT $(publish "$GOOD"); SELECT (expires_at = 'infinity')::int AS n FROM scouting_reports WHERE id = $(d $R)" "$PRO $LIVE $KEEP"
ROLE=anon run "the page still opens a kept report"                    "ALLOWED rows=1" "$(page)" "$MAKE_PLAYLIST $LIVE $KEEP"
ROLE=service_role run "the sweep leaves a kept report"                "ALLOWED rows=1" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $(report_row "now() - interval '8 days'" NULL) $KEEP"
ROLE=service_role run "the sweep deletes a kept report a week after it was stopped" "ALLOWED rows=0" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE $KEEP UPDATE scouting_reports SET revoked_at = now() - interval '8 days' WHERE id = $(d $R);"
ROLE=service_role run "releasing answers released"                    "ALLOWED rows=1" "SELECT (_keep_scouting_report($(d $R), false) = 'released')::int AS n" "$MAKE_PLAYLIST $LIVE $KEEP"
ROLE=service_role run "…and sets a fresh 30 days"                     "ALLOWED rows=1" "SELECT _keep_scouting_report($(d $R), false); SELECT (expires_at BETWEEN now() + interval '29 days' AND now() + interval '31 days')::int AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE $KEEP"
ROLE=service_role run "keeping a stopped report answers already_off"  "ALLOWED rows=1" "SELECT (_keep_scouting_report($(d $R), true) = 'already_off')::int AS n" "$MAKE_PLAYLIST $(report_row "now() + interval '10 days'" 'now()')"
ROLE=service_role run "an unknown id answers not_found"               "ALLOWED rows=1" "SELECT (_keep_scouting_report(gen_random_uuid(), true) = 'not_found')::int AS n" ""
run "keeping isn't the user's to call"                                "DENIED"         "SELECT _keep_scouting_report($(d $R), true)" "$MAKE_PLAYLIST $LIVE"

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
