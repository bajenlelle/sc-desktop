#!/usr/bin/env bash
#
# Checks for a scouting report's own clips (20261127100000_report_clip_lists,
# docs/scouting-reports.md, "The report's clips"): a playlist row of
# kind = 'report' is never shared as a playlist. A team share, a direct share,
# a legacy team_id and turning a shared playlist into a report container are
# refused with report_not_shareable; a playlist of kind 'playlist' still
# shares as before, and an unknown kind is refused by the column's check.
#
# Every probe runs inside BEGIN … ROLLBACK as the database owner (the guards
# are triggers, not RLS), on a club team and a user the database already has;
# nothing is committed.
#
#   SUPABASE_DB_URL=<url> supabase/tests/report_clip_lists.sh
#
# The URL is never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Set SUPABASE_DB_URL (the target's session pooler URL); this script runs through psql." >&2
  exit 1
fi
PSQL="${PSQL_BIN:-$(command -v psql || true)}"
if [[ -z "$PSQL" ]]; then echo "psql was not found (set PSQL_BIN)." >&2; exit 1; fi

FAILED=0
# $1 label, $2 expected (OK | RAISES:<token> | ERR:<sqlstate>), $3 statements after the seed
run() {
  local out
  out="$("$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f - 2>&1 <<SQL || true
\\set VERBOSITY verbose
BEGIN;
-- A club team (its org a club, not a personal space) and a member of that club.
CREATE TEMP TABLE seed ON COMMIT DROP AS
  SELECT t.id AS team_id, t.org_id, m.user_id
    FROM teams t
    JOIN organizations o ON o.id = t.org_id AND NOT coalesce(o.is_personal, false)
    JOIN org_memberships m ON m.org_id = t.org_id
   LIMIT 1;
INSERT INTO playlists (id, user_id, name, org_id, kind)
  SELECT '00000000-0000-4000-8000-00000000c1a1', user_id, 'probe report', org_id, 'report' FROM seed;
INSERT INTO playlists (id, user_id, name, org_id)
  SELECT '00000000-0000-4000-8000-00000000c1a2', user_id, 'probe playlist', org_id FROM seed;
$3;
SELECT 'done';
ROLLBACK;
SQL
)"
  local got
  if grep -q "report_not_shareable" <<<"$out"; then got="RAISES:report_not_shareable"
  elif grep -q "23514" <<<"$out"; then got="ERR:23514"
  elif grep -q "^done$" <<<"$out"; then got="OK"
  else got="OTHER"; fi
  if [[ "$got" == "$2" ]]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $got"; [[ -n "${VERBOSE:-}" ]] && echo "$out" | grep -v "^$" | tail -5; FAILED=$((FAILED + 1)); fi
}

run "the seed has a club team and member" OK "SELECT count(*) FROM seed HAVING count(*) = 1"
run "a team share of a report's clips is refused" RAISES:report_not_shareable \
  "INSERT INTO playlist_shares (playlist_id, team_id) SELECT '00000000-0000-4000-8000-00000000c1a1', team_id FROM seed"
run "a direct share of a report's clips is refused" RAISES:report_not_shareable \
  "INSERT INTO playlist_user_shares (playlist_id, user_id) SELECT '00000000-0000-4000-8000-00000000c1a1', user_id FROM seed"
run "a legacy team_id on a report's clips is refused" RAISES:report_not_shareable \
  "UPDATE playlists SET team_id = (SELECT team_id FROM seed) WHERE id = '00000000-0000-4000-8000-00000000c1a1'"
run "a playlist still shares with a team of its club" OK \
  "INSERT INTO playlist_shares (playlist_id, team_id) SELECT '00000000-0000-4000-8000-00000000c1a2', team_id FROM seed"
run "a shared playlist can't become a report's clips" RAISES:report_not_shareable \
  "INSERT INTO playlist_shares (playlist_id, team_id) SELECT '00000000-0000-4000-8000-00000000c1a2', team_id FROM seed; UPDATE playlists SET kind = 'report' WHERE id = '00000000-0000-4000-8000-00000000c1a2'"
run "an unshared playlist can become a report's clips" OK \
  "UPDATE playlists SET kind = 'report' WHERE id = '00000000-0000-4000-8000-00000000c1a2'"
run "an unknown kind is refused" ERR:23514 \
  "UPDATE playlists SET kind = 'reel' WHERE id = '00000000-0000-4000-8000-00000000c1a2'"

if [[ $FAILED -gt 0 ]]; then echo "$FAILED failed"; exit 1; fi
echo "all passed"
