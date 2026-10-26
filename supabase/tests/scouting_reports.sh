#!/usr/bin/env bash
#
# Checks for scouting reports (20261029100000).
#
# Player items: a 'player' playlist item is refused since 20261101100000 (the
# report is a draft per playlist; scouting_report_drafts.sh); a text item may
# still carry a stats card, a clip may not, reorder_playlist_items moves a text
# item. Publishing: only the playlist's owner, only on a paid plan, only with content
# of the right shape (version, section and clip counts, clip and poster key
# shapes, poster files of the caller's own); a second publish updates the same
# row (same link, a fresh 30 days). Reading: the table is the owner's to read
# and nobody's to write; the page's one anonymous door is get_scouting_report,
# which says valid, expired, revoked or not found. Revoking wipes the content
# and queues the clip files for the purge; deleting the playlist revokes; the
# sweep deletes rows a week past their end. (Which files the purge may delete,
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
FREE="$MAKE_PLAYLIST $(tier free)"

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
run "a free plan is refused"                      "RAISES:upgrade_required" "SELECT $(publish "$GOOD")" "$FREE"
ACTOR="$V" run "someone else's playlist is refused" "RAISES:not_owner" "SELECT $(publish "$GOOD")" "$PRO"
ROLE=anon run "anon can't publish"                "DENIED"         "SELECT $(publish "$GOOD")" "$PRO"

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
ROLE=anon run "…and nothing about its owner"      "ALLOWED rows=1" "SELECT (NOT (get_scouting_report($(d $R)) ?| ARRAY['user_id','playlist_id','clip_keys']))::int AS n" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "an expired report says so"         "ALLOWED rows=1" "SELECT (get_scouting_report($(d $R))->>'reason' = 'expired')::int AS n" "$MAKE_PLAYLIST $(report_row "now() - interval '1 day'" NULL)"
ROLE=anon run "a revoked report says so"          "ALLOWED rows=1" "SELECT (get_scouting_report($(d $R))->>'reason' = 'revoked')::int AS n" "$MAKE_PLAYLIST $(report_row "now() + interval '10 days'" 'now()')"
ROLE=anon run "an unknown id says not found"      "ALLOWED rows=1" "SELECT (get_scouting_report(gen_random_uuid())->>'reason' = 'not_found')::int AS n" ""

echo "== revoking"
run "the owner revokes: the content is wiped"    "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL AND content = '{}'::jsonb AND clip_keys = '{}'" "$MAKE_PLAYLIST $LIVE"
run "…and its clip file is queued for the purge"  "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); RESET ROLE; SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d $CK1)" "$MAKE_PLAYLIST $LIVE"
run "revoking twice is a no-op"                   "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT revoke_scouting_report($(d $R)); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL" "$MAKE_PLAYLIST $LIVE"
ACTOR="$V" run "someone else can't revoke it"     "RAISES:not_found" "SELECT revoke_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
ROLE=anon run "anon can't revoke"                 "DENIED"         "SELECT revoke_scouting_report($(d $R))" "$MAKE_PLAYLIST $LIVE"
run "publishing after a revoke makes a new link"  "ALLOWED rows=1" "SELECT revoke_scouting_report($(d $R)); SELECT (($(publish "$GOOD"))->>'id' <> $(d $R))::int AS n" "$PRO $LIVE"

echo "== a deleted playlist, and the sweep"
run "deleting the playlist revokes its report"    "ALLOWED rows=1" "DELETE FROM playlists WHERE id = $(d $PL); RESET ROLE; SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R) AND revoked_at IS NOT NULL AND content = '{}'::jsonb AND playlist_id IS NULL" "$MAKE_PLAYLIST $LIVE"
ROLE=service_role run "the sweep deletes a row a week past expiry" "ALLOWED rows=1" "SELECT (run_scouting_report_sweep() >= 1)::int AS n" "$MAKE_PLAYLIST $(report_row "now() - interval '8 days'" NULL)"
ROLE=service_role run "…and queues its clip file"                  "ALLOWED rows=1" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM media_deletions WHERE storage_key = $(d $CK1)" "$MAKE_PLAYLIST $(report_row "now() - interval '8 days'" NULL)"
ROLE=service_role run "…but leaves a live one"                     "ALLOWED rows=1" "SELECT run_scouting_report_sweep(); SELECT count(*) AS n FROM scouting_reports WHERE id = $(d $R)" "$MAKE_PLAYLIST $LIVE"
run "the sweep isn't the user's to call"          "DENIED"         "SELECT run_scouting_report_sweep()" ""

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
