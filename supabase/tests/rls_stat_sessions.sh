#!/usr/bin/env bash
#
# RLS and RPC checks for the stat keeper tables (20261004200000_stat_sessions).
#
# Owner writes; every signed-in user reads FINAL, unhidden sessions and their
# events; transcripts (stat_event_private) are owner-only; anonymous reads
# nothing. Every probe runs inside BEGIN … ROLLBACK against the linked
# project, so nothing is committed.
#
#   supabase/tests/rls_stat_sessions.sh
#
# Actors: U keeps the session, V is any other signed-in user.
set -euo pipefail

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
BIN="$(pick_supabase || true)"
if [[ -z "$BIN" ]]; then
  echo "No supabase CLI with 'db query' found. Update it or set SUPABASE_BIN." >&2
  exit 1
fi

U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$("$BIN" db query --linked "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1" </dev/null 2>/dev/null \
  | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); print(json.loads(m.group(0))["rows"][0]["v"])')"
S="aaaaaaaa-0000-4000-8000-00000000a001"
echo "# U=$U (keeper)  V=$V (other user)  session=$S"

FAILED=0
run() {  # $1=label $2=expected $3=sql as the actor [$4=privileged setup sql ending in ;]
  local out got st actor="${ACTOR:-$U}" role="${ROLE:-authenticated}"
  # Real anon requests carry no sub, so auth.uid() is null for them.
  local claims
  if [[ "$role" == anon ]]; then claims="{\"role\":\"anon\"}"; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out=$("$BIN" db query --linked "BEGIN; ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" </dev/null 2>&1 || true)
  if grep -q "42501\|violates row-level security" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q '"_tag":"Error"' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-58s expect=%-26s got=%-28s %s\n" "$1" "$2" "$got" "$st"
}

# Privileged fixture: U's session (live or final) with one made basket and one period row.
session_sql() {  # $1=status
  cat <<SQL
INSERT INTO stat_sessions (id, created_by, source_game_id, home_name, away_name, our_side, game_date, tipoff_at, status, finalized_at, revision)
VALUES ('$S', '$U', 'rls-test:game', 'Home', 'Away', 1, '2026-10-04', '2026-10-04T12:00:00Z', '$1', $( [[ $1 == final ]] && echo "now()" || echo "NULL" ), 1);
INSERT INTO stat_events (session_id, seq, client_id, kind, sub_type, is_successful, team_side, jersey, period, recorded_at, source)
VALUES ('$S', 1, 'c1', 'period', 'tipoff', 1, 1, NULL, 1, '2026-10-04T12:00:00Z', 'tap'),
       ('$S', 2, 'c2', '2pt', '', 1, 1, '9', 1, '2026-10-04T12:00:30Z', 'live');
INSERT INTO stat_event_private (session_id, seq, raw_utterance, confidence) VALUES ('$S', 2, 'tvåa nio', 0.9);
SQL
}
LIVE="$(session_sql live)"
FINAL="$(session_sql final)"

echo ""
echo "=== owner (U) ==="
run "INSERT own session" "ALLOWED rows=1" \
  "WITH i AS (INSERT INTO stat_sessions (id, created_by, home_name, away_name, our_side, game_date) VALUES ('$S', '$U', 'H', 'A', 1, '2026-10-04') RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT session for someone else" DENIED \
  "WITH i AS (INSERT INTO stat_sessions (id, created_by, home_name, away_name, our_side, game_date) VALUES ('$S', '$V', 'H', 'A', 1, '2026-10-04') RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT event into own session" "ALLOWED rows=1" \
  "WITH i AS (INSERT INTO stat_events (session_id, seq, client_id, kind, team_side, period, recorded_at, source) VALUES ('$S', 3, 'c3', 'rebound', 1, 1, now(), 'live') RETURNING 1) SELECT count(*) AS n FROM i" "$LIVE"
run "SELECT own live session" "ALLOWED rows=1" "SELECT count(*) AS n FROM stat_sessions WHERE id='$S'" "$LIVE"
run "SELECT own private rows" "ALLOWED rows=1" "SELECT count(*) AS n FROM stat_event_private WHERE session_id='$S'" "$LIVE"
run "finalize own session (has tip-off)" "ALLOWED" "SELECT (finalize_stat_session('$S')->>'event_count')::int AS n" "$LIVE"
run "finalize without any anchor raises" "RAISES:tipoff_missing" "SELECT finalize_stat_session('$S')" \
  "INSERT INTO stat_sessions (id, created_by, home_name, away_name, our_side, game_date) VALUES ('$S', '$U', 'H', 'A', 1, '2026-10-04');"
run "reopen own final session" "ALLOWED" "SELECT (reopen_stat_session('$S')->>'revision')::int AS n" "$FINAL"

echo ""
echo "=== another signed-in user (V) ==="
ACTOR="$V" run "SELECT U's LIVE session (invisible)" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_sessions WHERE id='$S'" "$LIVE"
ACTOR="$V" run "SELECT U's FINAL session (public layer)" "ALLOWED rows=1" "SELECT count(*) AS n FROM stat_sessions WHERE id='$S'" "$FINAL"
ACTOR="$V" run "SELECT events of U's FINAL session" "ALLOWED rows=2" "SELECT count(*) AS n FROM stat_events WHERE session_id='$S'" "$FINAL"
ACTOR="$V" run "SELECT events of U's LIVE session" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_events WHERE session_id='$S'" "$LIVE"
ACTOR="$V" run "SELECT U's private rows (never)" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_event_private WHERE session_id='$S'" "$FINAL"
ACTOR="$V" run "SELECT hidden FINAL session" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_sessions WHERE id='$S'" \
  "$FINAL UPDATE stat_sessions SET hidden_at = now() WHERE id='$S';"
ACTOR="$V" run "INSERT event into U's session" DENIED \
  "WITH i AS (INSERT INTO stat_events (session_id, seq, client_id, kind, team_side, period, recorded_at, source) VALUES ('$S', 9, 'c9', 'steal', 1, 1, now(), 'live') RETURNING 1) SELECT count(*) AS n FROM i" "$FINAL"
ACTOR="$V" run "UPDATE U's session (0 rows)" "ALLOWED rows=0" \
  "WITH u AS (UPDATE stat_sessions SET home_name='x' WHERE id='$S' RETURNING 1) SELECT count(*) AS n FROM u" "$FINAL"
ACTOR="$V" run "finalize U's session" "RAISES:not_session_owner" "SELECT finalize_stat_session('$S')" "$LIVE"
ACTOR="$V" run "list_stat_sessions_for_games sees the FINAL one" "ALLOWED rows=1" \
  "SELECT count(*) AS n FROM list_stat_sessions_for_games(ARRAY['rls-test:game','other'])" "$FINAL"
ACTOR="$V" run "list_stat_sessions_for_games skips LIVE" "ALLOWED rows=0" \
  "SELECT count(*) AS n FROM list_stat_sessions_for_games(ARRAY['rls-test:game'])" "$LIVE"

echo ""
echo "=== anonymous ==="
ROLE=anon ACTOR="00000000-0000-0000-0000-000000000000" run "SELECT FINAL sessions as anon" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_sessions WHERE id='$S'" "$FINAL"
ROLE=anon ACTOR="00000000-0000-0000-0000-000000000000" run "SELECT events as anon" "ALLOWED rows=0" "SELECT count(*) AS n FROM stat_events WHERE session_id='$S'" "$FINAL"
ROLE=anon ACTOR="00000000-0000-0000-0000-000000000000" run "list RPC as anon" "ALLOWED rows=0" "SELECT count(*) AS n FROM list_stat_sessions_for_games(ARRAY['rls-test:game'])" "$FINAL"

echo ""
if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
