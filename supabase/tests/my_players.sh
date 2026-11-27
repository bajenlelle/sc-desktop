#!/usr/bin/env bash
#
# Checks for my players (20261127100000): the my_players table.
#
# A row says which roster player an account is (one per account and source). The owner reads, changes and
# deletes theirs; a second row for the same source is refused; the person id, name and number are checked.
# Nobody else sees or changes a row, and anon never touches the table.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261127100000_my_players.sql supabase/tests/my_players.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/my_players.sh                                                                  # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler). The URL is never printed; its
# password is masked out of any output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "my_players.sh: failed at line $LINENO" >&2' ERR

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

# Throwaway accounts that sign up inside every probe. W's own row seeds the probe, so it doesn't lean on
# anything already saved.
W="00000000-0000-4000-8000-0000001b7001"    # the player
V="00000000-0000-4000-8000-0000001b7002"    # someone else
SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-myplayer-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-myplayer-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO my_players (user_id, person_id, name, number) VALUES ($(d $W), $(d 1234567), $(d 'Probe Player'), $(d 78));"

# Each prints one `n`: the rows it wrote or read.
save()   { echo "WITH x AS (INSERT INTO my_players (user_id, person_id, name, number) VALUES ($(d "$1"), $(d "$2"), $(d "$3"), $4) RETURNING 1) SELECT count(*) AS n FROM x"; }   # $1=user $2=person $3=name $4=number (SQL)
change() { echo "WITH x AS (UPDATE my_players SET person_id = $(d 7654321), name = $(d 'Probe Other'), updated_at = now() WHERE user_id = $(d $W) RETURNING 1) SELECT count(*) AS n FROM x"; }
remove() { echo "WITH x AS (DELETE FROM my_players WHERE user_id = $(d $W) RETURNING 1) SELECT count(*) AS n FROM x"; }

echo "# W=$W (the player)  V=$V (someone else)"
echo "== the player's own row"
run "the player reads theirs"                            "ALLOWED rows=1" "SELECT count(*) AS n FROM my_players"
run "…changes it"                                        "ALLOWED rows=1" "$(change)"
run "…deletes it"                                        "ALLOWED rows=1" "$(remove)"
ACTOR=$V run "someone else saves their own"              "ALLOWED rows=1" "$(save $V 555 'Probe V' NULL)"

echo "== the checks"
run "a second Genius row for the same account is refused" "ERR:23505"     "$(save $W 999 'Probe twice' NULL)"
run "a person id that isn't a number is refused"         "ERR:23514"      "$(save $V 'abc' 'Probe bad' NULL)"
run "a blank name is refused"                            "ERR:23514"      "$(save $V 123 '   ' NULL)"
run "a shirt number of four digits is refused"           "ERR:23514"      "$(save $V 123 'Probe four' "$(d 1234)")"

echo "== everyone else"
ACTOR=$V run "someone else can't see the player's row"   "ALLOWED rows=0" "SELECT count(*) AS n FROM my_players WHERE user_id = $(d $W)"
ACTOR=$V run "…nor change it"                            "ALLOWED rows=0" "$(change)"
ACTOR=$V run "…nor delete it"                            "ALLOWED rows=0" "$(remove)"
ACTOR=$V run "…nor save one as the player"               "DENIED"         "$(save $W 555 'Probe forged' NULL)"
ROLE=anon run "anon can't read"                          "DENIED"         "SELECT count(*) AS n FROM my_players"

if [[ $FAILED -ne 0 ]]; then echo "FAILED"; exit 1; fi
echo "All probes passed."
