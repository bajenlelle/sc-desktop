#!/usr/bin/env bash
#
# Access checks for video_sync_hints / video_sync_detect_runs (20261006100000).
#
# Both tables are RPC-only: RLS on, no policies. These probes prove that the
# RPCs validate their input, that an automatic hint never downgrades a confirmed
# one, that another user sees a published hint only through the lookup RPC, and
# that direct table access and anonymous calls are refused.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261006100000_video_sync_hints.sql supabase/tests/rls_video_sync_hints.sh   # before db push
#   supabase/tests/rls_video_sync_hints.sh                                                                        # after
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

# U keeps the hint, V is another signed-in user, A is a platform admin (if any).
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$("$BIN" db query --linked "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1" </dev/null 2>/dev/null \
  | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); print(json.loads(m.group(0))["rows"][0]["v"])')"
A="$("$BIN" db query --linked "SELECT id::text AS a FROM profiles WHERE is_platform_admin AND id <> \$\$$V\$\$ ORDER BY created_at LIMIT 1" </dev/null 2>/dev/null \
  | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); r=json.loads(m.group(0))["rows"]; print(r[0]["a"] if r else "")')"
echo "# U=$U (keeper)  V=$V (other user)  A=${A:-none} (platform admin)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

KEY="$(printf 'a%.0s' {1..64})"
H='ARRAY[$$00ff00ff00ff00ff$$,$$0123456789abcdef$$,$$fedcba9876543210$$]'
HNEAR='ARRAY[$$00ff00ff00ff00fe$$,$$0123456789abcdef$$,$$fedcba9876543210$$]'   # 1 bit away
HFAR='ARRAY[$$ff00ff00ff00ff00$$,$$fedcba9876543210$$,$$0123456789abcdef$$]'    # inverted / swapped
UPSERT_U="SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, \$\$profixio:32578145\$\$, 1254, \$\$confirmed\$\$, NULL)"

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS) | RAISES:<token> (guard) | BLOCKED (either)
  local out got st actor="${ACTOR:-$U}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out=$("$BIN" db query --linked "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" </dev/null 2>&1 || true)
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q '"_tag":"Error"' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$2:$got" in
    BLOCKED:DENIED*|BLOCKED:RAISES:*) st="PASS";;
    *) case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac;;
  esac
  printf "  %-62s expect=%-28s got=%-30s %s\n" "$1" "$2" "$got" "$st"
}

# Privileged setup: U's confirmed hint already exists (runs before the role switch).
SEED="INSERT INTO video_sync_hints (fingerprint_key, duration_ms, frame_hashes, source_game_id, tipoff_video_time, method, detected_by)
      VALUES (\$\$$KEY\$\$, 7112458, ARRAY[(\$\$x00ff00ff00ff00ff\$\$)::bit(64), (\$\$x0123456789abcdef\$\$)::bit(64), (\$\$xfedcba9876543210\$\$)::bit(64)], \$\$profixio:32578145\$\$, 1254, \$\$confirmed\$\$, \$\$$U\$\$);"

echo "# Writes"
run "upsert own confirmed hint"                        "ALLOWED rows=1" "WITH i AS ($UPSERT_U AS id) SELECT count(*) AS n FROM i"
run "upsert with a bad key"                             "RAISES:invalid_fingerprint" "SELECT upsert_video_sync_hint(\$\$nothex\$\$, 7112458, $H, NULL, 1254, \$\$auto\$\$, 0.9)"
run "upsert with a bad hash"                            "RAISES:invalid_fingerprint" "SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, ARRAY[\$\$zz\$\$], NULL, 1254, \$\$auto\$\$, 0.9)"
run "upsert with a bad method"                          "RAISES:invalid_method" "SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, NULL, 1254, \$\$guess\$\$, NULL)"
run "upsert with an absurd time"                        "RAISES:invalid_tipoff_time" "SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, NULL, 99999, \$\$auto\$\$, NULL)"
# The table is RPC-only, so the state is verified through the lookup RPC (separate statements: it is STABLE and must see the write).
run "auto never downgrades a confirmed hint"            "ALLOWED rows=1" "SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, NULL, 999, \$\$auto\$\$, 0.5); SELECT count(*) AS n FROM find_video_sync_hints(7112458, $H, NULL) f WHERE f.is_mine AND f.method = \$\$confirmed\$\$ AND f.tipoff_video_time = 1254" "$SEED"
run "confirmed overwrites an earlier auto hint"         "ALLOWED rows=1" "SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, NULL, 999, \$\$auto\$\$, 0.5); SELECT upsert_video_sync_hint(\$\$$KEY\$\$, 7112458, $H, NULL, 1254, \$\$confirmed\$\$, NULL); SELECT count(*) AS n FROM find_video_sync_hints(7112458, $H, NULL) f WHERE f.is_mine AND f.method = \$\$confirmed\$\$ AND f.tipoff_video_time = 1254"

echo "# Reads"
run "lookup with the same hashes (as U)"                "ALLOWED rows=1" "SELECT count(*) AS n FROM find_video_sync_hints(7112458, $H, NULL) f WHERE f.is_mine" "$SEED"
ACTOR="$V" run "lookup with hashes 1 bit away (as V)"   "ALLOWED rows=1" "SELECT count(*) AS n FROM find_video_sync_hints(7112500, $HNEAR, \$\$profixio:32578145\$\$) f WHERE NOT f.is_mine AND f.distances[1] = 1 AND f.method = \$\$confirmed\$\$" "$SEED"
ACTOR="$V" run "lookup with a 10 s duration gap"        "ALLOWED rows=0" "SELECT count(*) AS n FROM find_video_sync_hints(7122458, $H, NULL)" "$SEED"
ACTOR="$V" run "lookup with unrelated hashes"           "ALLOWED rows=0" "SELECT count(*) AS n FROM find_video_sync_hints(7112458, $HFAR, NULL)" "$SEED"
ACTOR="$V" run "lookup skips hidden hints"              "ALLOWED rows=0" "SELECT count(*) AS n FROM find_video_sync_hints(7112458, $H, NULL)" "$SEED UPDATE video_sync_hints SET hidden_at = now() WHERE fingerprint_key = \$\$$KEY\$\$;"
run "lookup with a bad hash"                            "RAISES:invalid_fingerprint" "SELECT count(*) AS n FROM find_video_sync_hints(7112458, ARRAY[\$\$zz\$\$], NULL)"

echo "# Direct table access"
run "select video_sync_hints directly"                  "ALLOWED rows=0" "SELECT count(*) AS n FROM video_sync_hints" "$SEED"
run "insert video_sync_hints directly"                  "DENIED" "INSERT INTO video_sync_hints (fingerprint_key, duration_ms, frame_hashes, tipoff_video_time, method, detected_by) VALUES (\$\$$KEY\$\$, 1000, ARRAY[(\$\$x00ff00ff00ff00ff\$\$)::bit(64)], 1, \$\$auto\$\$, \$\$$U\$\$)"
run "select video_sync_detect_runs directly"            "ALLOWED rows=0" "SELECT count(*) AS n FROM video_sync_detect_runs"
run "insert video_sync_detect_runs directly"            "DENIED" "INSERT INTO video_sync_detect_runs (user_id, action, frame_count, model, outcome) VALUES (\$\$$U\$\$, \$\$read_frames\$\$, 1, \$\$m\$\$, \$\$ok\$\$)"

echo "# Moderation"
ACTOR="$V" run "hide as a regular user"                 "RAISES:not_platform_admin" "SELECT hide_video_sync_hint((SELECT id FROM video_sync_hints WHERE fingerprint_key = \$\$$KEY\$\$ LIMIT 1))" "$SEED"
if [[ -n "$A" ]]; then
  ACTOR="$A" run "hide as a platform admin"             "ALLOWED" "SELECT hide_video_sync_hint((SELECT id FROM video_sync_hints WHERE fingerprint_key = \$\$$KEY\$\$ LIMIT 1))" "$SEED"
fi

echo "# Anonymous"
ROLE=anon run "lookup as anon"                          "BLOCKED" "SELECT count(*) AS n FROM find_video_sync_hints(7112458, $H, NULL)"
ROLE=anon run "upsert as anon"                          "BLOCKED" "$UPSERT_U"

if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
