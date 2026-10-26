#!/usr/bin/env bash
#
# Checks for moving content from a personal space into a club
# (20261028100000_move_to_club.sql; report drafts: 20261101100000).
#
# Only a coach or admin of an unlocked club can move, only their own content
# from their personal space, and demo games never move. A moved playlist takes
# its games along, its folder path is recreated in the club, its labels and
# sharing follow the rules, and a playlist that stays behind keeps its clips.
# A game the club already has merges into that copy only when nothing can
# shift; otherwise it moves as a second copy. Nobody but the service role
# reads the audit table or calls the internal helpers.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261028100000_move_to_club.sql supabase/tests/move_to_club.sh   # before applying
#   supabase/tests/move_to_club.sh                                                                     # after
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler), because `db query --db-url` sends one prepared statement at a time
# and can't hold a BEGIN … ROLLBACK. The URL is never printed; its password is
# masked out of any output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "move_to_club.sh: failed at line $LINENO" >&2' ERR

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

# One probe transaction. Prints something the classifier in run() reads the
# same way for both transports: the CLI's JSON, or for psql the errors (with
# SQLSTATEs, so "P0001: token" and "42501" appear as in the CLI's output)
# followed by a `"n": <value>` line built from the last row the probe printed.
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

PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | ALLOWED rows=N | DENIED (RLS/grant) | RAISES:<token> (guard) | BLOCKED (either)
  local out got st actor="${ACTOR:-$W}" role="${ROLE:-authenticated}" claims
  if [[ "$role" == "anon" ]]; then claims='{"role":"anon"}'; else claims="{\"sub\":\"$actor\",\"role\":\"$role\"}"; fi
  out="$(probe "BEGIN; $PREFLIGHT $SEED ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
  out="$(mask "$out")"
  if grep -q "42501\|violates row-level security\|permission denied" <<<"$out"; then
    got="DENIED"
  elif grep -qE 'P0001: [a-z_]+' <<<"$out"; then
    got="RAISES:$(grep -oE 'P0001: [a-z_]+' <<<"$out" | head -1 | sed 's/P0001: //')"
  elif grep -q '"_tag":"Error"\|ERROR:' <<<"$out"; then
    got="ERR:$(grep -o 'ERROR: *[0-9A-Z]*' <<<"$out" | head -1 || true)"
  else
    got="ALLOWED rows=$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || echo '?')"
  fi
  case "$2:$got" in
    BLOCKED:DENIED*|BLOCKED:RAISES:*) st="PASS";;
    *) case "$got" in "$2"*) st="PASS";; *) st="FAIL"; FAILED=1;; esac;;
  esac
  printf "  %-70s expect=%-28s got=%-30s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal
arr() {  # arr TYPE id… → ARRAY[…]::TYPE[]
  local t="$1" out="" x; shift
  for x in "$@"; do out+="${out:+,}\$\$$x\$\$"; done
  printf 'ARRAY[%s]::%s[]' "$out" "$t"
}

# Throwaway accounts that sign up inside every probe, so handle_new_user gives
# each a personal space (and seeds its default labels).
W="00000000-0000-4000-8000-0000000d0a01"    # the coach who moves
V="00000000-0000-4000-8000-0000000d0a02"    # someone else
P="00000000-0000-4000-8000-0000000d0a03"    # a player in the club
K="00000000-0000-4000-8000-0000000d0b01"    # the club
K2="00000000-0000-4000-8000-0000000d0b02"   # another club W coaches
F1="00000000-0000-4000-8000-0000000d0c01"   # personal folder "Probe outer"
F2="00000000-0000-4000-8000-0000000d0c02"   # "Probe inner", inside F1
L1="00000000-0000-4000-8000-0000000d0d01"   # in F2: GA 101 + 102
L2="00000000-0000-4000-8000-0000000d0d02"   # in F2: GB 201
L3="00000000-0000-4000-8000-0000000d0d03"   # top level: GA 101 (stays behind)
L4="00000000-0000-4000-8000-0000000d0d04"   # top level: a demo clip
LB="00000000-0000-4000-8000-0000000d0e01"   # W's own label "Probe tag"
SS="00000000-0000-4000-8000-0000000d0f01"   # a stat-keeper session
GA=mtc-probe-ga      # personal, source probe-src-a
GB=mtc-probe-gb      # personal, source probe-src-b
GN=mtc-probe-gn      # legacy, org_id NULL
GV=mtc-probe-gv      # V's, in V's personal space
GK2=mtc-probe-gk2    # W's copy of probe-src-a in K2
CA=mtc-probe-ca      # W's copy of probe-src-a in K (only in $DUP)
GD="demo-$W"         # W's sample game
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
PV="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $V) AND o.is_personal LIMIT 1)"

# Fixture games are logged as imported first: a game already in import_log
# re-imports for free, so they insert whatever the accounts' plans and the
# project's import rules are.
NT=$(d sweden-national-men)
SEED="INSERT INTO auth.users (id, email, created_at, raw_user_meta_data) VALUES
    ($(d $W), $(d probe-move-w@example.invalid), now(), $(d '{"full_name":"Probe W"}')::jsonb),
    ($(d $V), $(d probe-move-v@example.invalid), now(), $(d '{"full_name":"Probe V"}')::jsonb),
    ($(d $P), $(d probe-move-p@example.invalid), now(), $(d '{"full_name":"Probe P"}')::jsonb);
  INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d pro)), ($(d $K2), $(d 'Probe club 2'), $(d pro));
  INSERT INTO org_memberships (user_id, org_id, role) VALUES
    ($(d $W), $(d $K), $(d coach)), ($(d $W), $(d $K2), $(d coach)), ($(d $P), $(d $K), $(d player));
  INSERT INTO import_log (user_id, org_id, match_id, league_id, game_key) VALUES
    ($(d $W), $PW, $(d $GA), $NT, $(d probe-src-a)), ($(d $W), $PW, $(d $GB), $NT, $(d probe-src-b)),
    ($(d $W), $PW, $(d $GN), $NT, $(d $GN)), ($(d $V), $PV, $(d $GV), $NT, $(d probe-src-a));
  INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES
    ($(d $GA), $(d $W), $PW, $(d 'Probe A'), $NT, $(d probe-src-a)),
    ($(d $GB), $(d $W), $PW, $(d 'Probe B'), $NT, $(d probe-src-b)),
    ($(d $GN), $(d $W), NULL, $(d 'Probe legacy'), $NT, NULL),
    ($(d $GV), $(d $V), $PV, $(d 'Probe V'), $NT, $(d probe-src-a)),
    ($(d $GK2), $(d $W), $(d $K2), $(d 'Probe A in K2'), $NT, $(d probe-src-a));
  INSERT INTO matches (id, user_id, org_id, title, league_id, is_demo) VALUES ($(d $GD), $(d $W), $PW, $(d 'Sample game'), $NT, true);
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES
    ($(d $GA), 101, '2pt', 1), ($(d $GA), 102, '3pt', 2), ($(d $GB), 201, '2pt', 1), ($(d $GD), 301, '2pt', 1),
    ($(d $GK2), 101, '2pt', 1), ($(d $GK2), 102, '3pt', 2);
  INSERT INTO playlist_folders (id, user_id, org_id, name, sort_order) VALUES ($(d $F1), $(d $W), $PW, $(d 'Probe outer'), 0);
  INSERT INTO playlist_folders (id, user_id, org_id, name, sort_order, parent_id) VALUES ($(d $F2), $(d $W), $PW, $(d 'Probe inner'), 0, $(d $F1));
  INSERT INTO playlists (id, user_id, org_id, name, folder_id) VALUES
    ($(d $L1), $(d $W), $PW, $(d 'Probe list 1'), $(d $F2)), ($(d $L2), $(d $W), $PW, $(d 'Probe list 2'), $(d $F2)),
    ($(d $L3), $(d $W), $PW, $(d 'Probe list 3'), NULL), ($(d $L4), $(d $W), $PW, $(d 'Probe list 4'), NULL);
  INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES
    ($(d $L1), $(d $GA), 101, 0), ($(d $L1), $(d $GA), 102, 1), ($(d $L2), $(d $GB), 201, 0),
    ($(d $L3), $(d $GA), 101, 0), ($(d $L4), $(d $GD), 301, 0);
  INSERT INTO labels (id, user_id, org_id, name, color) VALUES ($(d $LB), $(d $W), $PW, $(d 'Probe tag'), $(d red));
  INSERT INTO clip_label_assignments (user_id, org_id, match_id, event_id, label_id, playlist_id) VALUES
    ($(d $W), $PW, $(d $GA), 101, $(d $LB), $(d $L1)),
    ($(d $W), $PW, $(d $GA), 101, (SELECT id FROM labels WHERE user_id = $(d $W) AND org_id = $PW AND name = $(d Iso)), NULL);"

# W's copy of probe-src-a already in the club, with the same plays.
DUP="INSERT INTO matches (id, user_id, org_id, title, league_id, source_game_id) VALUES ($(d $CA), $(d $W), $(d $K), $(d 'Probe A in club'), $NT, $(d probe-src-a));
  INSERT INTO play_by_play_events (match_id, event_id, type, period) VALUES ($(d $CA), 101, '2pt', 1), ($(d $CA), 102, '3pt', 2);"

# A share left on a personal playlist from before personal playlists were
# unshareable: shared while it sat in K2 (the guard only allows club
# playlists), then put back.
OLD_SHARE="INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $V), $(d $K2), $(d coach));
  UPDATE playlists SET org_id = $(d $K2), folder_id = NULL WHERE id = $(d $L1);
  INSERT INTO playlist_user_shares (playlist_id, user_id, shared_by) VALUES ($(d $L1), $(d $V), $(d $W));
  UPDATE playlists SET org_id = $PW, folder_id = $(d $F2) WHERE id = $(d $L1);"

mv() {  # mv "match ids" "playlist ids" "folder ids" [club]
  # shellcheck disable=SC2086
  printf 'SELECT move_to_club(%s::uuid, %s, %s, %s)' "$(d "${4:-$K}")" \
    "$(arr text $1)" "$(arr uuid $2)" "$(arr uuid $3)"
}
field() {  # field "<mv call>" key → the result's count as n
  printf "SELECT (%s)->>%s AS n" "$1" "$(d "$2")"
}

echo "# W=$W (coach)  V=$V (someone else)  P=$P (player)"
echo
echo "## Who may move, and what"
ROLE=anon run "anon can't move"                                               "DENIED"  "$(mv "$GA" "" "")"
ROLE=anon run "anon can't open the preview"                                   "DENIED"  "SELECT get_move_to_club_preview($(d $K)::uuid)"
ACTOR=$P run "a player in the club can't move into it"                        "RAISES:not_staff"  "$(mv "" "" "")"
run "moving into your own personal space is refused"                          "RAISES:target_not_club"  "SELECT move_to_club($PW, '{}'::text[], '{}'::uuid[], '{}'::uuid[])"
run "moving into a club you're not in is refused"                             "RAISES:not_staff"  "$(mv "$GA" "" "")" "DELETE FROM org_memberships WHERE user_id = $(d $W) AND org_id = $(d $K);"
run "a locked club refuses moves"                                             "RAISES:license_locked"  "$(mv "$GA" "" "")" "UPDATE organizations SET expires_at = now() - interval '60 days' WHERE id = $(d $K);"
run "a club in grace still takes them"                                        "ALLOWED rows=1"  "$(field "$(mv "$GA" "" "")" games_moved)" "UPDATE organizations SET expires_at = now() - interval '1 day' WHERE id = $(d $K);"
run "an empty move is refused"                                                "RAISES:nothing_to_move"  "$(mv "" "" "")"
run "someone else's game can't be moved"                                      "RAISES:not_movable"  "$(mv "$GV" "" "")"
run "your game in another club can't be moved"                                "RAISES:not_movable"  "$(mv "$GK2" "" "")"
run "a game already in the club can't be moved again"                         "RAISES:not_movable"  "$(mv "$CA" "" "")" "$DUP"
run "someone else's playlist can't be moved"                                  "RAISES:not_movable"  "$(mv "" "$L1" "")" "UPDATE playlists SET user_id = $(d $V), folder_id = NULL WHERE id = $(d $L1);"
run "a demo game can't be moved"                                              "RAISES:demo_not_movable"  "$(mv "$GD" "" "")"
run "a refused move changes nothing"                                          "ALLOWED rows=1"  "DO \$do\$ BEGIN PERFORM move_to_club($(d $K)::uuid, $(arr text $GA $GV), '{}'::uuid[], '{}'::uuid[]); EXCEPTION WHEN others THEN NULL; END \$do\$; RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $GA) AND org_id = $PW"
run "the merge helper is internal"                                            "DENIED"  "SELECT * FROM _move_to_club_merge_target($(d $W)::uuid, $(d $K)::uuid, $(d $GA))"
run "the gate helper is internal"                                             "DENIED"  "SELECT _move_to_club_gate($(d $W)::uuid, $(d $K)::uuid)"
run "the audit trail isn't readable by users"                                 "DENIED"  "SELECT count(*) AS n FROM space_moves"

echo
echo "## The preview"
run "the preview lists personal games, the legacy one included, no demo"      "ALLOWED rows=3"  "SELECT jsonb_array_length(get_move_to_club_preview($(d $K)::uuid)->'games') AS n"
run "the preview lists the personal playlists"                                "ALLOWED rows=4"  "SELECT jsonb_array_length(get_move_to_club_preview($(d $K)::uuid)->'playlists') AS n"
run "a playlist's preview names the games that come with it"                  "ALLOWED rows=1"  "SELECT jsonb_array_length(p->'match_ids') AS n FROM jsonb_array_elements(get_move_to_club_preview($(d $K)::uuid)->'playlists') p WHERE p->>'id' = $(d $L1)"
run "a demo clip is counted, not listed as a game"                            "ALLOWED rows=1"  "SELECT (p->>'demo_clip_count')::int AS n FROM jsonb_array_elements(get_move_to_club_preview($(d $K)::uuid)->'playlists') p WHERE p->>'id' = $(d $L4)"
run "the preview says the club copy will merge"                               "ALLOWED rows=1"  "SELECT count(*) AS n FROM jsonb_array_elements(get_move_to_club_preview($(d $K)::uuid)->'games') g WHERE g->>'id' = $(d $GA) AND (g->'duplicate'->>'mergeable')::boolean" "$DUP"
run "the preview says when plays differ"                                      "ALLOWED rows=1"  "SELECT count(*) AS n FROM jsonb_array_elements(get_move_to_club_preview($(d $K)::uuid)->'games') g WHERE g->>'id' = $(d $GA) AND g->'duplicate'->>'reason' = 'plays_differ'" "$DUP DELETE FROM play_by_play_events WHERE match_id = $(d $CA) AND event_id = 102;"
ACTOR=$P run "a player can't open the preview"                                "RAISES:not_staff"  "SELECT get_move_to_club_preview($(d $K)::uuid)"

echo
echo "## Moving"
run "a playlist takes its games along"                                        "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $GA) AND org_id = $(d $K)"
run "the playlist lands in the same folder path in the club"                  "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlists p JOIN playlist_folders f ON f.id = p.folder_id JOIN playlist_folders o ON o.id = f.parent_id WHERE p.id = $(d $L1) AND p.org_id = $(d $K) AND f.org_id = $(d $K) AND f.name = $(d 'Probe inner') AND o.org_id = $(d $K) AND o.name = $(d 'Probe outer') AND o.parent_id IS NULL"
run "moving one playlist leaves the personal folders"                         "ALLOWED rows=2"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_folders WHERE id IN ($(d $F1), $(d $F2))"
run "a playlist that stays keeps its clips on the moved game"                 "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $L3) AND match_id = $(d $GA)"
run "the demo clip keeps pointing at the personal sample game"                "ALLOWED rows=1"  "$(mv "" "$L4" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips pc JOIN matches m ON m.id = pc.match_id WHERE pc.playlist_id = $(d $L4) AND m.id = $(d $GD) AND m.org_id = $PW"
run "a second move lands in the same club folder"                             "ALLOWED rows=1"  "$(mv "" "$L1" ""); $(mv "" "$L2" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_folders WHERE org_id = $(d $K) AND name = $(d 'Probe inner')"
run "an existing same-named club folder is reused"                            "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" folders_reused)" "INSERT INTO playlist_folders (user_id, org_id, name, sort_order) VALUES ($(d $W), $(d $K), $(d 'probe OUTER '), 0);"
run "a folder moves with its subtree"                                         "ALLOWED rows=2"  "$(mv "" "" "$F1"); RESET ROLE; SELECT count(*) AS n FROM playlists WHERE id IN ($(d $L1), $(d $L2)) AND org_id = $(d $K) AND folder_id IS NOT NULL"
run "the moved personal folders are gone"                                     "ALLOWED rows=0"  "$(mv "" "" "$F1"); RESET ROLE; SELECT count(*) AS n FROM playlist_folders WHERE id IN ($(d $F1), $(d $F2))"
run "the club gets both folders"                                              "ALLOWED rows=2"  "$(mv "" "" "$F1"); RESET ROLE; SELECT count(*) AS n FROM playlist_folders WHERE user_id = $(d $W) AND org_id = $(d $K) AND name IN ($(d 'Probe outer'), $(d 'Probe inner'))"
run "a legacy game with no space moves"                                       "ALLOWED rows=1"  "$(mv "$GN" "" ""); RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $GN) AND org_id = $(d $K)"
run "a playlist-scoped label follows into the club"                           "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM clip_label_assignments a JOIN labels l ON l.id = a.label_id WHERE a.org_id = $(d $K) AND l.org_id = $(d $K) AND l.name = $(d 'Probe tag') AND a.playlist_id = $(d $L1) AND a.match_id = $(d $GA)"
run "a game's own label follows into the club"                                "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM clip_label_assignments a JOIN labels l ON l.id = a.label_id WHERE a.org_id = $(d $K) AND l.org_id = $(d $K) AND l.name = $(d Iso) AND a.playlist_id IS NULL AND a.match_id = $(d $GA)"
run "no label assignment is left in the personal space"                       "ALLOWED rows=0"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM clip_label_assignments WHERE match_id = $(d $GA) AND org_id = $PW"
run "the personal label stays"                                                "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM labels WHERE id = $(d $LB)"
run "only the missing label is created in the club"                           "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" labels_created)"
run "old sharing on a moved playlist is cleared"                              "ALLOWED rows=0"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_user_shares WHERE playlist_id = $(d $L1)" "$OLD_SHARE"
run "the club isn't charged an import"                                        "ALLOWED rows=0"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM import_log WHERE user_id = $(d $W) AND org_id = $(d $K)"
run "the move is logged"                                                      "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM space_moves WHERE user_id = $(d $W) AND to_org_id = $(d $K)"

echo
echo "## Merging into the club's copy"
run "the club copy takes the personal one's place"                            "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_merged)" "$DUP"
run "the personal copy is deleted"                                            "ALLOWED rows=0"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $GA)" "$DUP"
run "every clip, the staying playlist's too, points at the club copy"         "ALLOWED rows=3"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE match_id = $(d $CA) AND playlist_id IN ($(d $L1), $(d $L3))" "$DUP"
run "a clip file link stays as it was"                                        "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE match_id = $(d $CA) AND r2_url = $(d https://probe.invalid/clips/$GA/101.mp4)" "$DUP UPDATE playlist_clips SET r2_url = $(d https://probe.invalid/clips/$GA/101.mp4) WHERE playlist_id = $(d $L1) AND event_id = 101;"
run "a playlist with the play from both copies keeps one"                     "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $L1) AND event_id = 101" "$DUP INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES ($(d $L1), $(d $CA), 101, 2);"
run "watch history survives, without duplicates"                              "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM clip_views WHERE playlist_id = $(d $L3) AND event_id = 101" "$DUP INSERT INTO clip_views (user_id, playlist_id, match_id, event_id) VALUES ($(d $W), $(d $L3), $(d $GA), 101), ($(d $W), $(d $L3), $(d $CA), 101);"
run "a stats card names the club copy"                                        "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE playlist_id = $(d $L3) AND card #>> '{game,matchId}' = $(d $CA)" "$DUP INSERT INTO playlist_clips (playlist_id, item_type, text_content, position, card) VALUES ($(d $L3), 'text', $(d 'card'), 5, jsonb_build_object('type', 'stats', 'game', jsonb_build_object('matchId', $(d $GA))));"
run "a report draft's section stats and placements name the club copy too" "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM scouting_report_drafts WHERE playlist_id = $(d $L3) AND content->'sections'->0 #>> '{stats,game,matchId}' = $(d $CA) AND content->'placements'->>($(d $CA) || ':101') = 's1' AND NOT (content->'placements' ? ($(d $GA) || ':101'))" "$DUP INSERT INTO scouting_report_drafts (playlist_id, user_id, content) VALUES ($(d $L3), $(d $W), jsonb_build_object('v', 1, 'title', NULL, 'opponent', NULL, 'intro', '', 'sections', jsonb_build_array(jsonb_build_object('id', 's1', 'player', jsonb_build_object('id', '1', 'name', 'Probe', 'number', '7', 'teamId', NULL, 'teamName', 'X'), 'note', '', 'stats', jsonb_build_object('type', 'stats', 'v', 1, 'game', jsonb_build_object('matchId', $(d $GA))))), 'placements', jsonb_build_object($(d $GA) || ':101', 's1')));"
run "a club copy without video takes the personal video and sync"             "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $CA) AND video_url = $(d /v/a.mp4) AND sync_point = $(d '{"t":1}')::jsonb" "$DUP UPDATE matches SET video_url = $(d /v/a.mp4), sync_point = $(d '{"t":1}')::jsonb WHERE id = $(d $GA);"
run "the same file, unsynced in the club, merges and takes the sync"          "ALLOWED rows=1"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM matches WHERE id = $(d $CA) AND sync_point = $(d '{"t":1}')::jsonb" "$DUP UPDATE matches SET video_url = $(d /v/a.mp4), sync_point = $(d '{"t":1}')::jsonb WHERE id = $(d $GA); UPDATE matches SET video_url = $(d /v/a.mp4) WHERE id = $(d $CA);"

echo
echo "## When merging isn't safe, the game moves as a second copy"
run "a play missing from the club copy"                                       "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_kept_separate)" "$DUP DELETE FROM play_by_play_events WHERE match_id = $(d $CA) AND event_id = 102;"
run "…and the club copy is left as it was"                                    "ALLOWED rows=0"  "$(mv "" "$L1" ""); RESET ROLE; SELECT count(*) AS n FROM playlist_clips WHERE match_id = $(d $CA)" "$DUP DELETE FROM play_by_play_events WHERE match_id = $(d $CA) AND event_id = 102;"
run "a play recorded differently in the club copy"                            "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_kept_separate)" "$DUP UPDATE play_by_play_events SET type = 'freethrow' WHERE match_id = $(d $CA) AND event_id = 102;"
run "plays from a different stat-keeper session"                              "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_kept_separate)" "$DUP INSERT INTO stat_sessions (id, created_by, home_name, away_name, our_side, game_date) VALUES ($(d $SS), $(d $W), 'H', 'A', 1, current_date); UPDATE matches SET stats_session_id = $(d $SS) WHERE id = $(d $CA);"
run "a different video file"                                                  "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_kept_separate)" "$DUP UPDATE matches SET video_url = $(d /v/a.mp4) WHERE id = $(d $GA); UPDATE matches SET video_url = $(d /v/b.mp4) WHERE id = $(d $CA);"
run "the same file synced differently"                                        "ALLOWED rows=1"  "$(field "$(mv "" "$L1" "")" games_kept_separate)" "$DUP UPDATE matches SET video_url = $(d /v/a.mp4), sync_point = $(d '{"t":1}')::jsonb WHERE id = $(d $GA); UPDATE matches SET video_url = $(d /v/a.mp4), sync_point = $(d '{"t":2}')::jsonb WHERE id = $(d $CA);"
run "someone else's copy in the club never merges"                            "ALLOWED rows=0"  "$(field "$(mv "" "$L1" "")" games_merged)" "UPDATE matches SET org_id = $(d $K) WHERE id = $(d $GV);"
run "your copy in another club never merges"                                  "ALLOWED rows=0"  "$(field "$(mv "" "$L1" "")" games_merged)"

echo
if [[ $FAILED -ne 0 ]]; then echo "Some probes FAILED"; exit 1; fi
echo "All probes passed"
