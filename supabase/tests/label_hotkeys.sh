#!/usr/bin/env bash
#
# Checks for a key per label (20261111110000): labels.hotkey and set_label_hotkey.
#
# A label's key is its owner's to set, like the rest of the row. A key is 1 to
# 9 or NULL, one label per key in a vocabulary (a coach's labels in one space),
# and set_label_hotkey moves a key from the label that had it in one step.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261111110000_label_hotkeys.sql supabase/tests/label_hotkeys.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/label_hotkeys.sh                                                                    # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "label_hotkeys.sh: failed at line $LINENO" >&2' ERR

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

# One probe transaction: the errors (with SQLSTATEs) followed by a `"n": <value>`
# line built from the last row the probe printed.
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
run() {  # $1=label  $2=expected  $3=sql as the actor
  # expected: ALLOWED rows=N | DENIED (RLS / privilege) | ERR:<sqlstate>
  local out got st actor="${ACTOR:-$W}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $SEED SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -q 'ERROR:' <<<"$out"; then
    got="ERR:$(grep -oE 'ERROR: +[0-9A-Z]{5}' <<<"$out" | head -1 | grep -oE '[0-9A-Z]{5}$' || true)"
    if grep -qE 'not_owner|invalid_hotkey|not_authenticated' <<<"$out"; then got="$got $(grep -oE 'not_owner|invalid_hotkey|not_authenticated' <<<"$out" | head -1)"; fi
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-58s expect=%-22s got=%-22s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Throwaway accounts that sign up inside every probe, so handle_new_user gives
# each a personal space. The probe's own labels, so it doesn't lean on the
# default vocabulary.
W="00000000-0000-4000-8000-0000001a6e01"    # the coach
V="00000000-0000-4000-8000-0000001a6e02"    # someone else
personal() { echo "(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d "$1") AND o.is_personal LIMIT 1)"; }
PW="$(personal $W)"
PV="$(personal $V)"
LA="00000000-0000-4000-8000-0000001a6ea1"   # W's "Probe key A"
LB="00000000-0000-4000-8000-0000001a6ea2"   # W's "Probe key B"
LV="00000000-0000-4000-8000-0000001a6ea3"   # V's "Probe key A"

SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-keys-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-keys-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO labels (id, user_id, org_id, name, color) VALUES
    ($(d $LA), $(d $W), $PW, $(d 'Probe key A'), $(d violet)),
    ($(d $LB), $(d $W), $PW, $(d 'Probe key B'), $(d red)),
    ($(d $LV), $(d $V), $PV, $(d 'Probe key A'), $(d violet));"

set_key() { echo "SELECT set_label_hotkey($(d "$1"), $2)"; }                                   # $1=label  $2=key or NULL
has_key() { echo "SELECT count(*) AS n FROM labels WHERE id = $(d "$1") AND hotkey IS NOT DISTINCT FROM $2"; }   # 1 when the label's key is $2

echo "# W=$W (the coach)  V=$V (someone else)"
echo "== the coach's own labels"
run "a new label has no key"                             "ALLOWED rows=1" "$(has_key $LA NULL)"
run "the coach gives a label a key"                      "ALLOWED rows=1" "$(set_key $LA 1); $(has_key $LA 1)"
run "the same key again changes nothing"                 "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LA 1); $(has_key $LA 1)"
run "a second label takes another key"                   "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LB 9); $(has_key $LB 9)"
run "a label changes its key"                            "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LA 4); $(has_key $LA 4)"
run "the key is taken away"                              "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LA NULL); $(has_key $LA NULL)"

echo "== one label per key"
run "a key given to another label moves to it"           "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LB 1); $(has_key $LB 1)"
run "…and the label that had it has none"                "ALLOWED rows=1" "$(set_key $LA 1); $(set_key $LB 1); $(has_key $LA NULL)"
run "two labels can't hold one key (direct write)"       "ERR:23505"      "UPDATE labels SET hotkey = 2 WHERE id IN ($(d $LA), $(d $LB))"
run "someone else's vocabulary has its own keys"         "ALLOWED rows=1" "$(set_key $LA 1); RESET ROLE; UPDATE labels SET hotkey = 1 WHERE id = $(d $LV); $(has_key $LA 1)"

echo "== the check"
run "key 0 is refused"                                   "ERR:P0001 invalid_hotkey" "$(set_key $LA 0)"
run "key 10 is refused"                                  "ERR:P0001 invalid_hotkey" "$(set_key $LA 10)"
run "key 10 is refused on a direct write too"            "ERR:23514"      "UPDATE labels SET hotkey = 10 WHERE id = $(d $LA)"

echo "== everyone else"
ACTOR=$V run "someone else can't set the coach's key"    "ERR:P0001 not_owner" "$(set_key $LA 1)"
ACTOR=$V run "…nor write it directly"                    "ALLOWED rows=0" "WITH x AS (UPDATE labels SET hotkey = 1 WHERE id = $(d $LA) RETURNING 1) SELECT count(*) AS n FROM x"
ACTOR=$V run "someone else sets their own"               "ALLOWED rows=1" "$(set_key $LV 1); $(has_key $LV 1)"
ROLE=anon run "anon can't call it"                       "DENIED"         "$(set_key $LA 1)"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
