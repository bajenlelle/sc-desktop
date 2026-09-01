#!/usr/bin/env bash
#
# Write-path checks for the consolidated playlist RLS.
#
# 20260905100000 replaced two `FOR ALL` policies (playlist_clips_owner,
# events_owner) with explicit SELECT/INSERT/UPDATE/DELETE policies. The
# equivalence harness next door only proves reads are unchanged — this proves
# writes are still owner-scoped, which is what importing a game and editing a
# playlist depend on.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   supabase/tests/rls_write_paths.sh
#
# Fixture ids are resolved at runtime, so this keeps working as data changes.
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

# The actor: a coach who owns playlists and matches.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"

echo "# Resolving fixtures for $U ..."
FIX="$("$BIN" db query --linked "
SELECT
  (SELECT pc.id::text FROM playlist_clips pc JOIN playlists p ON p.id=pc.playlist_id WHERE p.user_id=\$\$$U\$\$ LIMIT 1) AS owned_clip,
  (SELECT p.id::text FROM playlists p WHERE p.user_id=\$\$$U\$\$ LIMIT 1) AS owned_playlist,
  (SELECT pc.id::text FROM playlist_clips pc JOIN playlists p ON p.id=pc.playlist_id WHERE p.user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_clip,
  (SELECT p.id::text FROM playlists p WHERE p.user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_playlist,
  (SELECT id FROM matches WHERE user_id=\$\$$U\$\$ LIMIT 1) AS owned_match,
  (SELECT id FROM matches WHERE user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_match" </dev/null 2>/dev/null \
 | python3 -c '
import sys, json, re
m = re.search(r"\{.*\}", sys.stdin.read(), re.S)
r = json.loads(m.group(0))["rows"][0]
missing = [k for k, v in r.items() if not v]
if missing:
    sys.stderr.write(f"missing fixtures: {missing}\n"); sys.exit(1)
for k, v in r.items():
    print(f"{k}={v}")
')"
eval "$FIX"
echo "$FIX" | sed 's/^/#   /'

FAILED=0
run() {  # $1=label  $2=expected(ALLOWED|DENIED)  $3=sql body
  local out got st
  out=$("$BIN" db query --linked "BEGIN; SELECT set_config(\$\$request.jwt.claims\$\$, \$\${\"sub\":\"$U\",\"role\":\"authenticated\"}\$\$, true); SET LOCAL ROLE authenticated; $3; ROLLBACK;" </dev/null 2>&1 || true)
  if grep -q "42501\|violates row-level security" <<<"$out"; then
    got="DENIED"
  elif grep -q '"_tag":"Error"' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-52s expect=%-8s got=%-24s %s\n" "$1" "$2" "$got" "$st"
}

echo ""
echo "=== playlist_clips writes (must stay owner-only) ==="
run "UPDATE own clip" ALLOWED \
  "WITH u AS (UPDATE playlist_clips SET note=note WHERE id=$owned_clip RETURNING 1) SELECT count(*) AS n FROM u"
run "UPDATE foreign clip (0 rows, no error)" ALLOWED \
  "WITH u AS (UPDATE playlist_clips SET note=note WHERE id=$foreign_clip RETURNING 1) SELECT count(*) AS n FROM u"
run "DELETE own clip" ALLOWED \
  "WITH d AS (DELETE FROM playlist_clips WHERE id=$owned_clip RETURNING 1) SELECT count(*) AS n FROM d"
run "DELETE foreign clip (0 rows)" ALLOWED \
  "WITH d AS (DELETE FROM playlist_clips WHERE id=$foreign_clip RETURNING 1) SELECT count(*) AS n FROM d"
run "INSERT clip -> own playlist" ALLOWED \
  "WITH i AS (INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES (\$\$$owned_playlist\$\$, \$\$$owned_match\$\$, 999999, 9999) RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT clip -> foreign playlist" DENIED \
  "WITH i AS (INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES (\$\$$foreign_playlist\$\$, \$\$$owned_match\$\$, 999999, 9999) RETURNING 1) SELECT count(*) AS n FROM i"

echo ""
echo "=== play_by_play_events writes (must stay own-matches-only) ==="
run "INSERT event -> own match" ALLOWED \
  "WITH i AS (INSERT INTO play_by_play_events (match_id, event_id, type) VALUES (\$\$$owned_match\$\$, 999999, \$\$test\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT event -> foreign match" DENIED \
  "WITH i AS (INSERT INTO play_by_play_events (match_id, event_id, type) VALUES (\$\$$foreign_match\$\$, 999999, \$\$test\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "DELETE events of own match" ALLOWED \
  "WITH d AS (DELETE FROM play_by_play_events WHERE match_id=\$\$$owned_match\$\$ RETURNING 1) SELECT count(*) AS n FROM d"
run "DELETE events of foreign match (0 rows)" ALLOWED \
  "WITH d AS (DELETE FROM play_by_play_events WHERE match_id=\$\$$foreign_match\$\$ RETURNING 1) SELECT count(*) AS n FROM d"

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "ALL WRITE-PATH CHECKS PASSED (nothing committed)"
else
  echo "WRITE-PATH CHECKS FAILED — do not ship" >&2
  exit 1
fi
