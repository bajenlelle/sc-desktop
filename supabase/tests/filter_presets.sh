#!/usr/bin/env bash
#
# Checks for filter presets (20261112110000): the filter_presets table.
#
# A preset is its owner's alone, like a label: one coach's own in one space (user_id + org_id).
# The owner saves, lists, renames and deletes theirs, in a space they belong to. A name is unique
# per coach and space, whatever its case, and a duplicate is refused. The name (1 to 40 characters)
# and the filters (an object with v = 1) are checked. Nobody else sees or changes a preset, and
# anon never touches the table.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261112110000_filter_presets.sql supabase/tests/filter_presets.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/filter_presets.sh                                                                      # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "filter_presets.sh: failed at line $LINENO" >&2' ERR

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
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-58s expect=%-22s got=%-22s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Throwaway accounts that sign up inside every probe, so handle_new_user gives
# each a personal space. The probe's own preset, so it doesn't lean on anything already saved.
W="00000000-0000-4000-8000-0000001a7001"    # the coach
V="00000000-0000-4000-8000-0000001a7002"    # someone else
personal() { echo "(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d "$1") AND o.is_personal LIMIT 1)"; }
PW="$(personal $W)"
PV="$(personal $V)"
P="00000000-0000-4000-8000-0000001a70a1"    # W's "Probe guard", in W's personal space

# The spaces are also kept in transaction settings: the actor's role can't look up a space it isn't
# a member of, so a probe naming W's space as V reads the id from here, not from `personal`.
SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-presets-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-presets-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO filter_presets (id, user_id, org_id, name, filters) VALUES
    ($(d $P), $(d $W), $PW, $(d 'Probe guard'), $(d '{"v":1}')::jsonb);
  SELECT set_config($(d probe.pw), $PW::text, true), set_config($(d probe.pv), $PV::text, true);"
SPW="current_setting($(d probe.pw))::uuid"   # W's space
SPV="current_setting($(d probe.pv))::uuid"   # V's space

# Each prints one `n`: the rows it wrote or read.
save()   { echo "WITH x AS (INSERT INTO filter_presets (user_id, org_id, name, filters) VALUES ($(d "$1"), $2, $(d "$3"), $(d "$4")::jsonb) RETURNING 1) SELECT count(*) AS n FROM x"; }   # $1=user  $2=space  $3=name  $4=filters
rename() { echo "WITH x AS (UPDATE filter_presets SET name = $(d 'Probe renamed') WHERE id = $(d $P) RETURNING 1) SELECT count(*) AS n FROM x"; }
remove() { echo "WITH x AS (DELETE FROM filter_presets WHERE id = $(d $P) RETURNING 1) SELECT count(*) AS n FROM x"; }

echo "# W=$W (the coach)  V=$V (someone else)"
echo "== the coach's own presets"
run "the coach saves a preset in their space"            "ALLOWED rows=1" "$(save $W "$SPW" 'Probe save' '{"v":1,"labels":[]}')"
run "…and lists theirs"                                  "ALLOWED rows=1" "SELECT count(*) AS n FROM filter_presets WHERE org_id = $SPW"
run "…renames theirs"                                    "ALLOWED rows=1" "$(rename)"
run "…deletes theirs"                                    "ALLOWED rows=1" "$(remove)"

echo "== the checks"
run "a name that differs only in case is refused"        "ERR:23505"      "$(save $W "$SPW" 'probe GUARD' '{"v":1}')"
run "a blank name is refused"                            "ERR:23514"      "$(save $W "$SPW" '   ' '{"v":1}')"
run "filters as an array are refused"                    "ERR:23514"      "$(save $W "$SPW" 'Probe array' '[1]')"
run "filters of version 2 are refused"                   "ERR:23514"      "$(save $W "$SPW" 'Probe v2' '{"v":2}')"

echo "== everyone else"
ACTOR=$V run "someone else can't see the coach's preset"       "ALLOWED rows=0" "SELECT count(*) AS n FROM filter_presets WHERE id = $(d $P)"
ACTOR=$V run "…nor rename it"                                  "ALLOWED rows=0" "$(rename)"
ACTOR=$V run "…nor delete it"                                  "ALLOWED rows=0" "$(remove)"
ACTOR=$V run "…nor save one as the coach (in their own space)" "DENIED"         "$(save $W "$SPV" 'Probe forged' '{"v":1}')"
ACTOR=$V run "…nor save one of their own in the coach's space" "DENIED"         "$(save $V "$SPW" 'Probe intruder' '{"v":1}')"
ROLE=anon run "anon can't read"                                "DENIED"         "SELECT count(*) AS n FROM filter_presets"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
