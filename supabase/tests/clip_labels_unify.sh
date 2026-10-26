#!/usr/bin/env bash
#
# Checks the merge of playlist labels into clip labels
# (20261030100000_unify_clip_labels.sql).
#
# Every probe seeds a coach with labelled clips, runs the migration on top of
# them, reads the result, and rolls back — nothing is committed, so it runs
# the same before and after the migration is applied for real.
#
#   supabase/tests/clip_labels_unify.sh
#   MIGRATION=path/to/other.sql supabase/tests/clip_labels_unify.sh
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler). The URL is never printed; its password is masked out of any output.
# VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "clip_labels_unify.sh: failed at line $LINENO" >&2' ERR

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

MODE=cli
MASK=""
if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  MODE=psql
  PSQL="${PSQL_BIN:-$(command -v psql || true)}"
  if [[ -z "$PSQL" ]]; then echo "SUPABASE_DB_URL is set but psql was not found (set PSQL_BIN)." >&2; exit 1; fi
  MASK="${SUPABASE_DB_URL#*//}"; MASK="${MASK#*:}"; MASK="${MASK%%@*}"   # the password
  echo "# Target: psql over SUPABASE_DB_URL (password masked in output)"
else
  BIN="$(pick_supabase || true)"
  if [[ -z "$BIN" ]]; then
    echo "No supabase CLI with 'db query' found. Update it or set SUPABASE_BIN." >&2
    exit 1
  fi
fi
mask() { if [[ -n "$MASK" ]]; then local s="$1"; echo "${s//"$MASK"/***}"; else echo "$1"; fi; }

probe() {  # $1=sql
  if [[ "$MODE" == psql ]]; then
    local rows errs status
    errs="$(mktemp)"
    rows="$("$PSQL" "$SUPABASE_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f - <<<$'\\set VERBOSITY verbose\n'"$1" 2>"$errs")" && status=0 || status=$?
    cat "$errs"; rm -f "$errs"
    if [[ $status -eq 0 ]]; then
      local n; n="$(grep -v '^$' <<<"$rows" | tail -1 || true)"
      echo "\"n\": ${n:-?}"
    fi
  else
    "$BIN" db query --linked "$1" </dev/null 2>&1 || true
  fi
}

MIGRATION="${MIGRATION:-supabase/migrations/20261030100000_unify_clip_labels.sql}"
MIGRATE="$(cat "$MIGRATION")"$'\n;'
echo "# Migration: $MIGRATION runs after the seed inside every probe (rolled back)"

FAILED=0
run() {  # $1=label  $2=expected rows  $3=sql read as the coach
  local out got st claims="{\"sub\":\"$W\",\"role\":\"authenticated\"}"
  out="$(probe "BEGIN; $SEED $MIGRATE SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE authenticated; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q '"_tag":"Error"\|ERROR:' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1 || true)"
  else
    got="rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  if [[ "$got" == "rows=$2" ]]; then st="PASS"; else st="FAIL"; FAILED=1; fi
  printf "  %-66s expect=rows=%-4s got=%-10s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# A throwaway coach who signs up inside every probe, so handle_new_user gives
# them a personal space and seeds its default labels (Iso, Drive, …).
W="00000000-0000-4000-8000-0000000e0a01"
L1="00000000-0000-4000-8000-0000000e0d01"   # playlist with GA 101
L2="00000000-0000-4000-8000-0000000e0d02"   # another playlist with GA 101
GA=clu-probe-ga
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
ISO="(SELECT id FROM labels WHERE user_id = $(d $W) AND org_id = $PW AND name = $(d Iso))"
DRIVE="(SELECT id FROM labels WHERE user_id = $(d $W) AND org_id = $PW AND name = $(d Drive))"

# The coach's labels before the merge:
#   GA 101  Iso    on the clip (Jan) and again in L1 (Feb)
#   GA 101  Drive  in L1 and in L2
#   GA 102  Iso    in L1, but 102 is no longer in L1
SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-labels-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb);
  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key) VALUES
    ($(d $W), $PW, $(d $GA), $(d sweden-national-men), $(d probe-src-labels));
  INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES
    ($(d $GA), $(d $W), $PW, $(d 'Probe A'), $(d sweden-national-men), $(d probe-src-labels));
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES ($(d $GA), 101, '2pt', 1), ($(d $GA), 102, '3pt', 2);
  INSERT INTO playlists (id, user_id, org_id, name) VALUES ($(d $L1), $(d $W), $PW, $(d 'Probe list 1')), ($(d $L2), $(d $W), $PW, $(d 'Probe list 2'));
  INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES ($(d $L1), $(d $GA), 101, 0), ($(d $L2), $(d $GA), 101, 0);
  INSERT INTO clip_label_assignments (user_id, org_id, match_id, event_id, label_id, playlist_id, assigned_at) VALUES
    ($(d $W), $PW, $(d $GA), 101, $ISO, NULL, $(d 2026-01-01)),
    ($(d $W), $PW, $(d $GA), 101, $ISO, $(d $L1), $(d 2026-02-01)),
    ($(d $W), $PW, $(d $GA), 101, $DRIVE, $(d $L1), $(d 2026-02-01)),
    ($(d $W), $PW, $(d $GA), 101, $DRIVE, $(d $L2), $(d 2026-03-01)),
    ($(d $W), $PW, $(d $GA), 102, $ISO, $(d $L1), $(d 2026-02-01));"

MINE="FROM clip_label_assignments WHERE user_id = $(d $W) AND match_id = $(d $GA)"

echo
echo "## After the merge"
run "every label the coach put anywhere is on the clip, once"   3  "SELECT count(*) AS n $MINE AND playlist_id IS NULL"
run "no playlist label is left"                                  0  "SELECT count(*) AS n $MINE AND playlist_id IS NOT NULL"
run "a label that was on the clip and in a playlist keeps its date"  1  "SELECT count(*) AS n $MINE AND event_id = 101 AND label_id = $ISO AND assigned_at = $(d 2026-01-01)"
run "a label from two playlists becomes one row"                 1  "SELECT count(*) AS n $MINE AND event_id = 101 AND label_id = $DRIVE"
run "…with the earlier date"                                     1  "SELECT count(*) AS n $MINE AND event_id = 101 AND label_id = $DRIVE AND assigned_at = $(d 2026-02-01)"
run "a label on a clip that left its playlist comes along"      1  "SELECT count(*) AS n $MINE AND event_id = 102 AND label_id = $ISO AND playlist_id IS NULL"

echo
if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
