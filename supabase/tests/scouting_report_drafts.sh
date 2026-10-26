#!/usr/bin/env bash
#
# Checks for scouting report drafts (20261101100000).
#
# A draft is one row per playlist and the owner's alone: they make, read,
# change and delete it; nobody else reads it; nobody makes one on another
# user's playlist; anon never touches the table. The content check holds a
# draft to version 1, an object of placements, at most 60 sections and 256 KB.
# A playlist row of item_type 'player' is refused from now on. The carry-over
# turns a playlist's player cards into its draft (sections in card order, each
# clip placed under the card above it) and deletes the rows; nobody but the
# migration calls it. A merge through move_to_club re-points a draft's section
# stats and placement keys at the club copy, in every draft that names the game.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   SUPABASE_DB_URL=<url> RLS_PREFLIGHT=supabase/migrations/20261101100000_scouting_report_drafts.sql supabase/tests/scouting_report_drafts.sh   # before applying
#   SUPABASE_DB_URL=<url> supabase/tests/scouting_report_drafts.sh                                                                           # after
#
# Runs through psql over SUPABASE_DB_URL (e.g. staging's session pooler), because
# `db query --db-url` sends one prepared statement at a time and can't hold a
# BEGIN … ROLLBACK. The URL is never printed; its password is masked out of any
# output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "scouting_report_drafts.sh: failed at line $LINENO" >&2' ERR

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

# One probe transaction: the errors (with SQLSTATEs, so "P0001: token" and
# "42501" appear) followed by a `"n": <value>` line built from the last row the
# probe printed.
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
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS / privilege) | RAISES:<token> | ERR (any other error)
  local out got st actor="${ACTOR:-$W}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $SEED ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q 'ERROR:' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1 || true)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac
  printf "  %-70s expect=%-18s got=%-26s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# Throwaway accounts that sign up inside every probe, so handle_new_user gives
# each a personal space. The fixture games are logged as imported first, so
# they insert whatever the accounts' plans and the project's import rules are.
W="00000000-0000-4000-8000-0000000d4a01"    # the coach who owns the drafts
V="00000000-0000-4000-8000-0000000d4a02"    # someone else
K="00000000-0000-4000-8000-0000000d4b01"    # a club W coaches (the merge probes)
PL="00000000-0000-4000-8000-0000000d4d01"   # W's playlist with the report
PL2="00000000-0000-4000-8000-0000000d4d02"  # W's other playlist (stays behind in a move)
PLV="00000000-0000-4000-8000-0000000d4d03"  # V's playlist
GA=srd-probe-ga      # W's personal game, source probe-src-a
CA=srd-probe-ca      # W's copy of the same game in K (only in $DUP)
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
PV="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $V) AND o.is_personal LIMIT 1)"
NT=$(d sweden-national-men)

SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-draft-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-draft-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb);
  INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d pro));
  INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $W), $(d $K), $(d coach));
  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key) VALUES ($(d $W), $PW, $(d $GA), $NT, $(d probe-src-a));
  INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES ($(d $GA), $(d $W), $PW, $(d 'Probe A'), $NT, $(d probe-src-a));
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES ($(d $GA), 101, '2pt', 1), ($(d $GA), 102, '3pt', 2), ($(d $GA), 103, '2pt', 2);
  INSERT INTO playlists (id, user_id, org_id, name) VALUES
    ($(d $PL), $(d $W), $PW, $(d 'Probe report')), ($(d $PL2), $(d $W), $PW, $(d 'Probe other')), ($(d $PLV), $(d $V), $PV, $(d 'Probe V'));
  INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES
    ($(d $PL), $(d $GA), 101, 0), ($(d $PL), $(d $GA), 102, 2), ($(d $PL), $(d $GA), 103, 4), ($(d $PL2), $(d $GA), 101, 0);"

# W's copy of probe-src-a already in the club, with the same plays: a move merges into it.
DUP="INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES ($(d $CA), $(d $W), $(d $K), $(d 'Probe A in club'), $NT, $(d probe-src-a));
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES ($(d $CA), 101, '2pt', 1), ($(d $CA), 102, '3pt', 2), ($(d $CA), 103, '2pt', 2);"

section() {  # $1=id  $2=player id  $3=stats json
  printf '{"id":"%s","player":{"id":"%s","name":"Alva Berg","number":"7","teamId":null,"teamName":"X"},"note":"","stats":%s}' "$1" "$2" "$3"
}
draft() {  # $1=sections json  $2=placements json  [$3=intro]
  printf '{"v":1,"title":null,"opponent":null,"intro":"%s","sections":%s,"placements":%s}' "${3:-}" "$1" "$2"
}
GOOD="$(draft "[$(section s1 1 null)]" '{}')"
insert_draft() {  # $1=playlist  $2=user  $3=content json
  echo "WITH x AS (INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $1), $(d $2), $(d "$3")::jsonb) RETURNING 1) SELECT count(*) AS n FROM x"
}
insert_draft_expr() {  # $1=a SQL jsonb expression
  echo "WITH x AS (INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL), $(d $W), $1) RETURNING 1) SELECT count(*) AS n FROM x"
}
DRAFT_ROW="INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL), $(d $W), $(d "$GOOD")::jsonb);"
has() {  # has <playlist> <condition on the draft> → 1 when its draft matches
  echo "SELECT count(*) AS n FROM scouting_report_drafts WHERE playlist_id = $(d $1) AND ($2)"
}

echo "# W=$W (owner)  V=$V (someone else)"
echo "== the owner's draft"
run "the owner makes a draft"                          "ALLOWED rows=1" "$(insert_draft $PL $W "$GOOD")"
run "…and upserts it in place"                         "ALLOWED rows=1" "$(insert_draft $PL $W "$GOOD"); INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL), $(d $W), $(d "$(draft '[]' '{}' hello)")::jsonb) ON CONFLICT (playlist_id) DO UPDATE SET content = EXCLUDED.content; $(has $PL "content->>'intro' = 'hello'")"
run "…reads it"                                        "ALLOWED rows=1" "$(has $PL true)" "$DRAFT_ROW"
run "…changes it, and updated_at moves"                "ALLOWED rows=1" "UPDATE scouting_report_drafts SET content = jsonb_set(content, '{intro}', '\"x\"') WHERE playlist_id = $(d $PL); $(has $PL "content->>'intro' = 'x' AND updated_at > now() - interval '1 hour'")" "$DRAFT_ROW UPDATE scouting_report_drafts SET updated_at = now() - interval '1 day' WHERE playlist_id = $(d $PL);"
run "…deletes it"                                      "ALLOWED rows=0" "DELETE FROM scouting_report_drafts WHERE playlist_id = $(d $PL); $(has $PL true)" "$DRAFT_ROW"
run "one draft per playlist"                           "ERR"            "$(insert_draft $PL $W "$GOOD")" "$DRAFT_ROW"
run "the owner can't put a draft on someone else's playlist" "DENIED"   "$(insert_draft $PLV $W "$GOOD")"
ACTOR="$V" run "someone else reads none"               "ALLOWED rows=0" "$(has $PL true)" "$DRAFT_ROW"
ACTOR="$V" run "someone else can't make a draft on the owner's playlist" "DENIED" "$(insert_draft $PL $V "$GOOD")"
ACTOR="$V" run "…nor one in the owner's name"          "DENIED"         "$(insert_draft $PL $W "$GOOD")"
ACTOR="$V" run "…nor change the owner's"               "ALLOWED rows=0" "WITH x AS (UPDATE scouting_report_drafts SET content = jsonb_set(content, '{intro}', '\"x\"') WHERE playlist_id = $(d $PL) RETURNING 1) SELECT count(*) AS n FROM x" "$DRAFT_ROW"
ACTOR="$V" run "…nor delete it"                        "ALLOWED rows=0" "WITH x AS (DELETE FROM scouting_report_drafts WHERE playlist_id = $(d $PL) RETURNING 1) SELECT count(*) AS n FROM x" "$DRAFT_ROW"
ROLE=anon run "anon can't read the table"              "DENIED"         "SELECT count(*) AS n FROM scouting_report_drafts" "$DRAFT_ROW"
ROLE=anon run "anon can't write it"                    "DENIED"         "$(insert_draft $PL $W "$GOOD")"

echo "== what a draft may hold"
bad() {  # $1=label  $2=content sql expression
  run "$1" "ERR" "$(insert_draft_expr "$2")"
}
bad "version 2"                       "$(d "$(echo "$GOOD" | sed 's/"v":1/"v":2/')")::jsonb"
bad "no version"                      "($(d "$GOOD")::jsonb - 'v')"
bad "content that isn't an object"    "'[]'::jsonb"
bad "no placements"                   "($(d "$GOOD")::jsonb - 'placements')"
bad "placements that aren't an object" "jsonb_set($(d "$GOOD")::jsonb, '{placements}', '[]'::jsonb)"
bad "no sections"                     "($(d "$GOOD")::jsonb - 'sections')"
bad "sections that aren't an array"   "jsonb_set($(d "$GOOD")::jsonb, '{sections}', '{}'::jsonb)"
bad "61 sections"                     "jsonb_set($(d "$GOOD")::jsonb, '{sections}', (SELECT jsonb_agg($(d "$(section s 1 null)")::jsonb) FROM generate_series(1,61)))"
bad "content over 256 KB"             "jsonb_set($(d "$GOOD")::jsonb, '{intro}', to_jsonb(repeat('x',270000)))"
run "60 sections are fine"            "ALLOWED rows=1" "$(insert_draft_expr "jsonb_set($(d "$GOOD")::jsonb, '{sections}', (SELECT jsonb_agg($(d "$(section s 1 null)")::jsonb) FROM generate_series(1,60)))")"
run "an empty draft is fine"          "ALLOWED rows=1" "$(insert_draft $PL $W "$(draft '[]' '{}')")"

echo "== player rows are refused"
CARD='{"type":"player","v":1,"player":{"id":"1","name":"Probe","number":"7","teamId":null,"teamName":"X"},"note":"","stats":null}'
insert_item() {  # $1=item_type  $2=card sql
  echo "WITH x AS (INSERT INTO playlist_clips (playlist_id, item_type, item_id, match_id, event_id, text_content, position, card) VALUES ($(d $PL), '$1', 'probe-new', $( [[ $1 == clip ]] && echo "$(d $GA), 104" || echo "NULL, NULL" ), 'Probe', 9, $2) RETURNING 1) SELECT count(*) AS n FROM x"
}
run "a player item with a player card"            "ERR"            "$(insert_item player "$(d "$CARD")::jsonb")"
run "a player item with no card"                  "ERR"            "$(insert_item player NULL)"
run "a text item with a stats card still works"   "ALLOWED rows=1" "$(insert_item text "$(d '{"type":"stats","v":1}')::jsonb")"
run "a plain text item still works"               "ALLOWED rows=1" "$(insert_item text NULL)"
run "a clip still works"                          "ALLOWED rows=1" "$(insert_item clip NULL)"
run "a clip with a card doesn't"                  "ERR"            "$(insert_item clip "$(d '{"type":"stats","v":1}')::jsonb")"

echo "== a deleted playlist"
run "deleting the playlist deletes the draft"     "ALLOWED rows=0" "DELETE FROM playlists WHERE id = $(d $PL); RESET ROLE; SELECT count(*) AS n FROM scouting_report_drafts WHERE playlist_id = $(d $PL)" "$DRAFT_ROW"

echo "== the carry-over"
# Player rows can't be inserted anymore, so the probe lifts the check for its
# transaction and seeds a report as the old desktop wrote it: PL has clips at
# positions 0, 2, 4 (seed); the cards go between them. card-x has no player
# object: not a section, but its row goes too.
CARDS="ALTER TABLE playlist_clips DROP CONSTRAINT IF EXISTS playlist_clips_card_check;
  INSERT INTO playlist_clips (playlist_id, item_type, item_id, text_content, position, card) VALUES
    ($(d $PL), 'player', 'card-a', '#7 Alva Berg', 1, $(d '{"type":"player","v":1,"player":{"id":"1","name":"Alva Berg","number":"7","teamId":null,"teamName":"X"},"note":"n-a","stats":{"type":"stats","v":1,"game":{"matchId":"'$GA'"}}}')::jsonb),
    ($(d $PL), 'player', 'card-b', '#9 Bo Berg', 3, $(d '{"type":"player","v":1,"player":{"id":"2","name":"Bo Berg","number":"9","teamId":null,"teamName":"X"}}')::jsonb),
    ($(d $PL), 'player', 'card-x', 'broken', 5, $(d '{"type":"player","v":1}')::jsonb);
  INSERT INTO playlist_clips (playlist_id, item_type, item_id, text_content, position) VALUES ($(d $PL), 'text', 'note-1', 'Intermission', 6);"
CARRY="RESET ROLE; SELECT _carry_player_cards_to_drafts(); SET LOCAL ROLE authenticated;"
run "the carry-over makes one draft per playlist with cards" "ALLOWED rows=1" "RESET ROLE; SELECT _carry_player_cards_to_drafts() AS n" "$CARDS"
run "the sections are the cards, in order, under their item ids" "ALLOWED rows=1" "$CARRY $(has $PL "jsonb_array_length(content->'sections') = 2 AND content->'sections'->0->>'id' = 'card-a' AND content->'sections'->1->>'id' = 'card-b'")" "$CARDS"
run "…each with its player, note and stats"       "ALLOWED rows=1" "$CARRY $(has $PL "content->'sections'->0->'player'->>'name' = 'Alva Berg' AND content->'sections'->0->>'note' = 'n-a' AND content->'sections'->0 #>> '{stats,game,matchId}' = $(d $GA) AND content->'sections'->1->'player'->>'id' = '2' AND content->'sections'->1->>'note' = '' AND content->'sections'->1->'stats' = 'null'::jsonb")" "$CARDS"
run "a clip goes under the card above it"         "ALLOWED rows=1" "$CARRY $(has $PL "content->'placements'->>'$GA:102' = 'card-a' AND content->'placements'->>'$GA:103' = 'card-b'")" "$CARDS"
run "a clip above the first card has no placement" "ALLOWED rows=1" "$CARRY $(has $PL "NOT (content->'placements' ? '$GA:101') AND (SELECT count(*) FROM jsonb_object_keys(content->'placements')) = 2")" "$CARDS"
run "the header starts empty"                     "ALLOWED rows=1" "$CARRY $(has $PL "content->>'v' = '1' AND content->'title' = 'null'::jsonb AND content->'opponent' = 'null'::jsonb AND content->>'intro' = ''")" "$CARDS"
run "the player rows are gone"                    "ALLOWED rows=0" "$CARRY SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $PL) AND item_type = 'player'" "$CARDS"
run "…the clips and the text item stay"           "ALLOWED rows=4" "$CARRY SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $PL)" "$CARDS"
run "a playlist without cards gets no draft"      "ALLOWED rows=0" "$CARRY $(has $PL2 true)" "$CARDS"
run "a playlist that has a draft keeps it"        "ALLOWED rows=1" "$CARRY $(has $PL "content->>'intro' = 'kept'")" "$CARDS INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL), $(d $W), $(d "$(draft '[]' '{}' kept)")::jsonb);"
run "…and isn't counted"                          "ALLOWED rows=0" "RESET ROLE; SELECT _carry_player_cards_to_drafts() AS n" "$CARDS INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL), $(d $W), $(d "$(draft '[]' '{}' kept)")::jsonb);"
run "the carry-over isn't the user's to call"     "DENIED"         "SELECT _carry_player_cards_to_drafts()"
ROLE=anon run "…nor anon's"                       "DENIED"         "SELECT _carry_player_cards_to_drafts()"

echo "== a merge through move_to_club"
# PL's draft: a section whose stats name the personal game, a placement on
# each of its clips, and one already on the club copy's clip 102. PL2 stays
# behind, with a draft that names the game too.
MERGE_DRAFTS="INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES
    ($(d $PL), $(d $W), $(d "$(draft "[$(section s1 1 '{"type":"stats","v":1,"game":{"matchId":"'$GA'"}}'),$(section s2 2 null)]" '{"'$GA':101":"s1","'$GA':102":"team","'$CA':102":"s2"}')")::jsonb),
    ($(d $PL2), $(d $W), $(d "$(draft "[$(section s1 1 '{"type":"stats","v":1,"game":{"matchId":"'$GA'"}}')]" '{"'$GA':101":"s1"}')")::jsonb);"
MV="SELECT move_to_club($(d $K)::uuid, '{}'::text[], ARRAY[$(d $PL)]::uuid[], '{}'::uuid[])"
run "the game merges into the club copy"          "ALLOWED rows=1" "SELECT (($MV)->>'games_merged')::int AS n" "$DUP $MERGE_DRAFTS"
run "a placement key follows the game"            "ALLOWED rows=1" "$MV; $(has $PL "content->'placements'->>'$CA:101' = 's1' AND NOT (content->'placements' ? '$GA:101')")" "$DUP $MERGE_DRAFTS"
run "a placement the club copy already had wins"  "ALLOWED rows=1" "$MV; $(has $PL "content->'placements'->>'$CA:102' = 's2' AND NOT (content->'placements' ? '$GA:102') AND (SELECT count(*) FROM jsonb_object_keys(content->'placements')) = 2")" "$DUP $MERGE_DRAFTS"
run "a section's stats name the club copy"        "ALLOWED rows=1" "$MV; $(has $PL "content->'sections'->0 #>> '{stats,game,matchId}' = $(d $CA) AND content->'sections'->1->'stats' = 'null'::jsonb AND jsonb_array_length(content->'sections') = 2")" "$DUP $MERGE_DRAFTS"
run "a draft on a playlist that stays behind is re-pointed too" "ALLOWED rows=1" "$MV; $(has $PL2 "content->'placements'->>'$CA:101' = 's1' AND content->'sections'->0 #>> '{stats,game,matchId}' = $(d $CA)")" "$DUP $MERGE_DRAFTS"
run "a draft that doesn't name the game is left alone" "ALLOWED rows=1" "$MV; $(has $PL2 "content = $(d "$GOOD")::jsonb")" "$DUP INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $PL2), $(d $W), $(d "$GOOD")::jsonb);"
run "the move's answer has the same fields"       "ALLOWED rows=14" "SELECT count(*) AS n FROM jsonb_object_keys(($MV))" "$DUP $MERGE_DRAFTS"

echo
if [[ $FAILED -eq 0 ]]; then echo "All probes passed."; else echo "Some probes FAILED."; exit 1; fi
