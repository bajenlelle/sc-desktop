#!/usr/bin/env bash
#
# Checks for scouting reports on players' phones (20261124100000):
# scouting_report_recipients and scouting_report_reads, and the functions that
# alone read and write them (docs/scouting-reports.md, "On players' phones").
#
# A coach's live club report goes to a team and to members of the club; it
# reaches the team's members and the people named, while they are in the club;
# they record reading it; the coach sees who read how much. Nobody else sends,
# reads the delivery or records reading, and no client touches the tables.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed, and
# the throwaway accounts have no devices, so no push is sent.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261124100000_scouting_report_recipients.sql supabase/tests/scouting_report_recipients.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/scouting_report_recipients.sh                                                                                     # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), as
# archive_games.sh does. The URL is never printed; its password is masked out
# of any output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "scouting_report_recipients.sh: failed at line $LINENO" >&2' ERR

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
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=more privileged setup, ending in ;]
  # expected: ALLOWED rows=N | DENIED (RLS / privilege) | RAISES:<token> | ERR:<sqlstate>
  local out got st actor="${ACTOR:-$C}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $SEED ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'ERROR: +P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q 'ERROR:' <<<"$out"; then
    got="ERR:$(grep -oE 'ERROR: +[0-9A-Z]{5}' <<<"$out" | head -1 | grep -oE '[0-9A-Z]{5}$' || true)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2") st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-64s expect=%-24s got=%-24s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Throwaway accounts (handle_new_user gives each a personal space), a club with
# a team, and the coach's live report in it.
C="00000000-0000-4000-8000-0000000a5c01"    # the coach who owns the report
P="00000000-0000-4000-8000-0000000a5c02"    # a player on the team
Q="00000000-0000-4000-8000-0000000a5c03"    # a club member on no team
X="00000000-0000-4000-8000-0000000a5c04"    # someone outside the club
CLUB="00000000-0000-4000-8000-0000000a5c10"
TEAM="00000000-0000-4000-8000-0000000a5c11"
OTHER_TEAM="00000000-0000-4000-8000-0000000a5c12"   # a team of another club
OTHER_CLUB="00000000-0000-4000-8000-0000000a5c13"
LIST="00000000-0000-4000-8000-0000000a5c20"
REPORT="00000000-0000-4000-8000-0000000a5c30"
K1="clips/probe-sr/1_pre10.0_post3.0_s100.0.mp4"
K2="clips/probe-sr/2_pre10.0_post3.0_s200.0.mp4"
PERSONAL_LIST="00000000-0000-4000-8000-0000000a5c21"
PERSONAL_REPORT="00000000-0000-4000-8000-0000000a5c31"
PC="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $C) AND o.is_personal LIMIT 1)"

SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $C), $(d probe-sr-c@example.invalid), now(), $(d '{"full_name":"Probe Coach"}')::jsonb),
    ($(d $P), $(d probe-sr-p@example.invalid), now(), $(d '{"full_name":"Probe Player"}')::jsonb),
    ($(d $Q), $(d probe-sr-q@example.invalid), now(), $(d '{"full_name":"Probe Member"}')::jsonb),
    ($(d $X), $(d probe-sr-x@example.invalid), now(), $(d '{"full_name":"Probe Outsider"}')::jsonb);
  INSERT INTO organizations (id, name, is_personal, expires_at) VALUES
    ($(d $CLUB), $(d 'Probe club'), false, now() + interval '1 year'),
    ($(d $OTHER_CLUB), $(d 'Probe other club'), false, now() + interval '1 year');
  INSERT INTO org_memberships (user_id, org_id, role) VALUES
    ($(d $C), $(d $CLUB), 'coach'), ($(d $P), $(d $CLUB), 'player'), ($(d $Q), $(d $CLUB), 'player');
  INSERT INTO teams (id, org_id, name) VALUES ($(d $TEAM), $(d $CLUB), $(d 'Probe team')), ($(d $OTHER_TEAM), $(d $OTHER_CLUB), $(d 'Probe other team'));
  INSERT INTO team_members (team_id, user_id, role) VALUES ($(d $TEAM), $(d $P), 'player'), ($(d $TEAM), $(d $C), 'coach');
  INSERT INTO playlists (id, user_id, org_id, name) VALUES
    ($(d $LIST), $(d $C), $(d $CLUB), $(d 'Probe list')),
    ($(d $PERSONAL_LIST), $(d $C), $PC, $(d 'Probe personal list'));
  INSERT INTO scouting_reports (id, user_id, playlist_id, title, content, content_key, clip_keys) VALUES
    ($(d $REPORT), $(d $C), $(d $LIST), $(d 'Probe report'), $(d '{"v":1,"header":{"opponent":"AIK"},"sections":[]}')::jsonb, $(d k), ARRAY[$(d $K1), $(d $K2)]),
    ($(d $PERSONAL_REPORT), $(d $C), $(d $PERSONAL_LIST), $(d 'Probe personal'), $(d '{"v":1,"header":{},"sections":[]}')::jsonb, $(d k), ARRAY[$(d $K1)]);"

SEND_TEAM="SELECT (send_scouting_report($(d $REPORT), ARRAY[$(d $TEAM)]::uuid[], '{}')->>'reached')::int AS n"
SENT="INSERT INTO scouting_report_recipients (report_id, team_id, sent_by) VALUES ($(d $REPORT), $(d $TEAM), $(d $C));
  INSERT INTO scouting_report_recipients (report_id, user_id, sent_by) VALUES ($(d $REPORT), $(d $Q), $(d $C));"

echo "# C=$C (coach)  P=$P (player on the team)  Q=$Q (member, sent directly)  X=$X (outsider)"
echo "== the coach sends"
run "send to the team reaches its player (not the coach)"            "ALLOWED rows=1" "$SEND_TEAM"
run "send to a member of the club"                                    "ALLOWED rows=1" "SELECT (send_scouting_report($(d $REPORT), '{}', ARRAY[$(d $Q)]::uuid[])->>'reached')::int AS n"
run "send to a team of another club"                                  "RAISES:team_not_in_report_org" "SELECT send_scouting_report($(d $REPORT), ARRAY[$(d $OTHER_TEAM)]::uuid[], '{}') IS NOT NULL AS n"
run "send to someone outside the club"                                "RAISES:recipient_not_in_org" "SELECT send_scouting_report($(d $REPORT), '{}', ARRAY[$(d $X)]::uuid[]) IS NOT NULL AS n"
run "send a report from a personal space"                             "RAISES:report_not_in_club" "SELECT send_scouting_report($(d $PERSONAL_REPORT), '{}', ARRAY[$(d $P)]::uuid[]) IS NOT NULL AS n"
run "send a stopped report"                                           "RAISES:report_not_live" "$SEND_TEAM" \
  "UPDATE scouting_reports SET revoked_at = now() WHERE id = $(d $REPORT);"
run "send while the club's licence has ended"                         "RAISES:license_locked" "$SEND_TEAM" \
  "UPDATE organizations SET expires_at = now() - interval '60 days' WHERE id = $(d $CLUB);"
run "the delivery lists both people reached"                          "ALLOWED rows=2" \
  "SELECT jsonb_array_length(get_scouting_report_delivery($(d $REPORT))->'readers') AS n" "$SENT"

echo "== the player reads"
ACTOR=$P run "the player lists the report"                            "ALLOWED rows=1" "SELECT count(*) AS n FROM get_my_scouting_reports()" "$SENT"
ACTOR=$P run "the player records a watched clip"                      "ALLOWED rows=1" \
  "SELECT record_scouting_report_read($(d $REPORT), $(d $K2)); SELECT cardinality(watched_keys) AS n FROM get_my_scouting_reports()" "$SENT"
ACTOR=$P run "a key the report doesn't hold is ignored"               "ALLOWED rows=0" \
  "SELECT record_scouting_report_read($(d $REPORT), $(d clips/probe-sr/nope.mp4)); SELECT cardinality(watched_keys) AS n FROM get_my_scouting_reports()" "$SENT"
ACTOR=$P run "a player who left the team no longer has it"            "ALLOWED rows=0" "SELECT count(*) AS n FROM get_my_scouting_reports()" \
  "$SENT DELETE FROM team_members WHERE user_id = $(d $P);"
ACTOR=$P run "a stopped report is gone"                               "ALLOWED rows=0" "SELECT count(*) AS n FROM get_my_scouting_reports()" \
  "$SENT UPDATE scouting_reports SET revoked_at = now() WHERE id = $(d $REPORT);"

echo "== everyone else"
ACTOR=$X run "an outsider lists nothing"                              "ALLOWED rows=0" "SELECT count(*) AS n FROM get_my_scouting_reports()" "$SENT"
ACTOR=$X run "an outsider can't record reading"                       "RAISES:not_recipient" "SELECT record_scouting_report_read($(d $REPORT)) IS NULL AS n" "$SENT"
ACTOR=$P run "a player can't send the coach's report"                 "RAISES:not_owner" "$SEND_TEAM"
ACTOR=$P run "a player can't read the delivery"                       "RAISES:not_owner" "SELECT get_scouting_report_delivery($(d $REPORT)) IS NOT NULL AS n" "$SENT"
ACTOR=$P run "a player reads no recipients rows directly"             "DENIED" "SELECT count(*) AS n FROM scouting_report_recipients" "$SENT"
ACTOR=$P run "a player writes no reads rows directly"                 "DENIED" \
  "INSERT INTO scouting_report_reads (report_id, user_id) VALUES ($(d $REPORT), $(d $P))"
ROLE=anon run "anon can't list"                                       "DENIED" "SELECT count(*) AS n FROM get_my_scouting_reports()"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
