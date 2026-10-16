#!/usr/bin/env bash
#
# Access checks for baskettv_tipoff_runs (20261007100000): RPC-only table that only
# the tip-off bot (app_config.tipoff_bot_email) may write and read through the RPCs;
# everyone else is refused, direct table access shows nothing, anonymous calls fail.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261007100000_baskettv_tipoff_runs.sql supabase/tests/rls_baskettv_tipoff_runs.sh   # before db push
#   supabase/tests/rls_baskettv_tipoff_runs.sh                                                                             # after
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

# B is the bot (any uid, identified by its email claim), V is another signed-in user.
B="${RLS_BOT_USER:-28403aa1-94b0-4614-883d-0d4a01fd046e}"
BOT_EMAIL="${RLS_BOT_EMAIL:-tipoff-bot@scoutable.se}"
V="$("$BIN" db query --linked "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$B\$\$ ORDER BY created_at LIMIT 1" </dev/null 2>/dev/null \
  | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); print(json.loads(m.group(0))["rows"][0]["v"])')"
echo "# B=$B ($BOT_EMAIL, bot)  V=$V (other user)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

RECORD="SELECT record_baskettv_tipoff_run(\$\$abcd1234\$\$, \$\$superettanherr\$\$, \$\$Herrar - Superettan Herr\$\$, \$\$m1\$\$, now(), \$\$Home\$\$, \$\$Away\$\$, \$\$found\$\$, 336.5, \$\$clock_transition\$\$, 0.92, NULL, 4, 91, 126000000, NULL)"
SEED="INSERT INTO baskettv_tipoff_runs (game_slug, channel, status) VALUES (\$\$abcd1234\$\$, \$\$superettanherr\$\$, \$\$failed\$\$);"

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS) | RAISES:<token> (guard) | BLOCKED (either)
  local out got st actor="${ACTOR:-$B}" role="${ROLE:-authenticated}" email="${EMAIL:-}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'
  elif [[ -n "$email" ]]; then claims="{\"sub\":\"$actor\",\"role\":\"$role\",\"email\":\"$email\"}"
  else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
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

echo "# Bot writes and reads"
EMAIL="$BOT_EMAIL" run "record a run as the bot"                        "ALLOWED rows=1" "$RECORD; SELECT count(*) AS n FROM list_baskettv_tipoff_runs(ARRAY[\$\$abcd1234\$\$]) WHERE status = \$\$found\$\$ AND attempts = 1"
EMAIL="$BOT_EMAIL" run "a second record counts another attempt"        "ALLOWED rows=1" "$RECORD; SELECT count(*) AS n FROM list_baskettv_tipoff_runs(ARRAY[\$\$abcd1234\$\$]) WHERE status = \$\$found\$\$ AND attempts = 2" "$SEED"
EMAIL="$BOT_EMAIL" run "list unknown slugs"                            "ALLOWED rows=0" "SELECT count(*) AS n FROM list_baskettv_tipoff_runs(ARRAY[\$\$nope\$\$])"
EMAIL="$BOT_EMAIL" run "record with a bad status"                      "RAISES:invalid_status" "SELECT record_baskettv_tipoff_run(\$\$abcd1234\$\$, \$\$superettanherr\$\$, NULL, NULL, now(), NULL, NULL, \$\$maybe\$\$)"
EMAIL="$BOT_EMAIL" run "record with a bad slug"                        "RAISES:invalid_game" "SELECT record_baskettv_tipoff_run(\$\$../etc\$\$, \$\$superettanherr\$\$, NULL, NULL, now(), NULL, NULL, \$\$found\$\$)"

echo "# Other users"
ACTOR="$V" run "record as a regular user (no email claim)"            "RAISES:not_batch_user" "$RECORD"
ACTOR="$V" EMAIL="someone@example.com" run "record as a regular user (other email)" "RAISES:not_batch_user" "$RECORD"
ACTOR="$V" EMAIL="someone@example.com" run "list as a regular user"   "RAISES:not_batch_user" "SELECT count(*) AS n FROM list_baskettv_tipoff_runs(ARRAY[\$\$abcd1234\$\$])" "$SEED"

echo "# Direct table access"
EMAIL="$BOT_EMAIL" run "select baskettv_tipoff_runs directly (bot)"    "ALLOWED rows=0" "SELECT count(*) AS n FROM baskettv_tipoff_runs" "$SEED"
EMAIL="$BOT_EMAIL" run "insert baskettv_tipoff_runs directly (bot)"    "DENIED" "INSERT INTO baskettv_tipoff_runs (game_slug, channel, status) VALUES (\$\$zzzz9999\$\$, \$\$superettanherr\$\$, \$\$found\$\$)"

echo "# Anonymous"
ROLE=anon run "record as anon"                                        "BLOCKED" "$RECORD"
ROLE=anon run "list as anon"                                          "BLOCKED" "SELECT count(*) AS n FROM list_baskettv_tipoff_runs(ARRAY[\$\$abcd1234\$\$])"

if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
