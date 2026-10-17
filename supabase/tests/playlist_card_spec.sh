#!/usr/bin/env bash
#
# Checks for card specs on playlist items (20261017200000).
#
# A text item may carry a `card` spec (a stats card); a clip row may not, and
# a spec must be a JSON object of at most 16 KB. Access is the playlist's own
# row rules: the owner writes and reads, someone else can do neither on a
# private playlist.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261017200000_playlist_card_spec.sql supabase/tests/playlist_card_spec.sh   # before db push
#   supabase/tests/playlist_card_spec.sh                                                                          # after
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

q1() {  # first column of the first row of a privileged query
  "$BIN" db query --linked "$1" </dev/null 2>/dev/null \
    | python3 -c 'import sys,re,json; m=re.search(r"\{.*\}", sys.stdin.read(), re.S); r=json.loads(m.group(0))["rows"]; print(list(r[0].values())[0] if r else "")'
}

# U owns the probe playlist, V is another signed-in user.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"
V="$(q1 "SELECT id::text AS v FROM auth.users WHERE id <> \$\$$U\$\$ ORDER BY created_at LIMIT 1")"
echo "# U=$U (owner)  V=$V (someone else)"

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

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

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

PL=00000000-0000-4000-8000-00000c0a0d01   # a throwaway playlist owned by U
CARD='{"type":"stats","v":1,"scope":"game","player":{"id":"1","name":"Probe"}}'
MAKE_PLAYLIST="INSERT INTO playlists (id, user_id, name) VALUES ($(d $PL), $(d $U), $(d 'card probe'));"
MAKE_CARD="$MAKE_PLAYLIST INSERT INTO playlist_clips (playlist_id, item_type, item_id, text_content, duration_seconds, position, card) VALUES ($(d $PL), 'text', 'probe-card', 'Probe · 24 PTS', 5, 0, $(d "$CARD")::jsonb);"
insert_item() {  # $1=item_type  $2=card sql
  echo "WITH x AS (INSERT INTO playlist_clips (playlist_id, item_type, item_id, match_id, event_id, text_content, duration_seconds, position, card) VALUES ($(d $PL), '$1', 'probe-new', $( [[ $1 == clip ]] && echo "$(d no-such-match), 1" || echo "NULL, NULL" ), 'Probe', 5, 1, $2) RETURNING 1) SELECT count(*) AS n FROM x"
}

echo "== writing specs (owner)"
run "a text item with a card"                 "ALLOWED rows=1" "$(insert_item text "$(d "$CARD")::jsonb")" "$MAKE_PLAYLIST"
run "a plain text item, no card"              "ALLOWED rows=1" "$(insert_item text "NULL")" "$MAKE_PLAYLIST"
run "a clip row with a card"                  "ERR"            "$(insert_item clip "$(d "$CARD")::jsonb")" "$MAKE_PLAYLIST"
run "a card that isn't an object"             "ERR"            "$(insert_item text "$(d '[1,2]')::jsonb")" "$MAKE_PLAYLIST"
run "a card over 16 KB"                       "ERR"            "$(insert_item text "jsonb_build_object('type','stats','pad',repeat('x',17000))")" "$MAKE_PLAYLIST"
run "changing the card on an existing item"   "ALLOWED rows=1" "WITH x AS (UPDATE playlist_clips SET card = card || '{\"columns\":[\"pts\"]}'::jsonb, text_content = 'Probe · 24 PTS' WHERE playlist_id = $(d $PL) AND item_id = 'probe-card' RETURNING 1) SELECT count(*) AS n FROM x" "$MAKE_CARD"
run "reading the card back"                   "ALLOWED rows=1" "SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $PL) AND card->>'type' = 'stats'" "$MAKE_CARD"

echo "== someone else (private playlist)"
ACTOR="$V" run "can't read the card"          "ALLOWED rows=0" "SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $PL) AND card IS NOT NULL" "$MAKE_CARD"
ACTOR="$V" run "can't change the card"        "ALLOWED rows=0" "WITH x AS (UPDATE playlist_clips SET card = NULL WHERE playlist_id = $(d $PL) RETURNING 1) SELECT count(*) AS n FROM x" "$MAKE_CARD"
ACTOR="$V" run "can't add a card item"        "DENIED"         "$(insert_item text "$(d "$CARD")::jsonb")" "$MAKE_PLAYLIST"

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
