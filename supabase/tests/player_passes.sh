#!/usr/bin/env bash
#
# Player passes (20261027100000): the import decision, purchases and the
# hardening that came with them.
#
# A new game in a Free personal space is paid for, in order, by a season pass
# that covers it, a free trial slot (2 games for accounts created from
# free_games_two_since, 3 before), or a bought single. A re-import is free.
# Purchases are written only by the service role or a platform admin. A saved
# game can't become another game, and an import must target a space the
# importer may import into.
#
# Every probe creates a throwaway account and made-up teams and fixtures
# inside BEGIN … ROLLBACK, so nothing is committed.
#
#   RLS_PREFLIGHT=supabase/migrations/20261027100000_player_passes.sql supabase/tests/player_passes.sh   # before db push
#   supabase/tests/player_passes.sh                                                                     # after
#
# Runs against the linked project (prod) through the CLI, unless
# SUPABASE_DB_URL is set: then every probe runs through psql (e.g. staging
# through the session pooler), because `db query --db-url` sends one prepared
# statement at a time and can't hold a BEGIN … ROLLBACK. The URL is never
# printed; its password is masked out of any output.
set -euo pipefail
trap 'echo "player_passes.sh: failed at line $LINENO" >&2' ERR

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
  out="$(probe "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\$$claims\$\$, true); SET LOCAL ROLE $role; $3; ROLLBACK;" || true)"
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
  printf "  %-66s expect=%-28s got=%-30s %s\n" "$1" "$2" "$got" "$st"
  if [[ "$st" == "FAIL" && -n "${VERBOSE:-}" ]]; then echo "$out" | sed 's/^/      /' | head -20; fi
}

d() { printf '$$%s$$' "$1"; }   # dollar-quote a literal

# W: a throwaway account that signs up inside the probe (so after the switch).
W="00000000-0000-4000-8000-00000000a0a1"
K="00000000-0000-4000-8000-00000000b0b1"   # a club
N="00000000-0000-4000-8000-00000000b0b2"   # a national-team space
PUR="00000000-0000-4000-8000-00000000c0c1"
SP="00000000-0000-4000-8000-00000000c0c2"
PW="(SELECT o.id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $(d $W) AND o.is_personal LIMIT 1)"
team() { printf "(SELECT league_team_id FROM league_team_sources WHERE source = \$\$genius\$\$ AND source_team_id = \$\$%s\$\$)" "$1"; }

# Made-up league: club A plays as pp-9911 in 2025/26 and pp-9901 in 2026/27;
# B (pp-9902) and C (pp-9903) play 2026/27; D (pp-9914) only 2025/26.
# Games (match ids can't collide with real Genius ids):
#   …01 A–B  …02 B–C  …03 C–A  …04 B–C  …05 C–B  (2026/27)   …11 A–B (2025/26)
FIXTURES='[{"matchId":9900000001,"competitors":[{"teamId":"pp-9901"},{"teamId":"pp-9902"}]},
           {"matchId":9900000002,"competitors":[{"teamId":"pp-9902"},{"teamId":"pp-9903"}]},
           {"matchId":9900000003,"competitors":[{"teamId":"pp-9903"},{"teamId":"pp-9901"}]},
           {"matchId":9900000004,"competitors":[{"teamId":"pp-9902"},{"teamId":"pp-9903"}]},
           {"matchId":9900000005,"competitors":[{"teamId":"pp-9903"},{"teamId":"pp-9902"}]}]'
FIXTURES_OLD='[{"matchId":9900000011,"competitors":[{"teamId":"pp-9911"},{"teamId":"pp-9902"}]}]'

SEED="UPDATE app_config SET value = $(d true) WHERE key = $(d player_pass_enabled);
  INSERT INTO app_config (key, value) VALUES ($(d free_games_two_since), (now() - interval '1 hour')::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO auth.users (id, email, created_at, raw_user_meta_data)
    VALUES ($(d $W), $(d probe-pass@example.invalid), now(), $(d '{"full_name":"Probe Pass"}')::jsonb);
  SELECT sync_league_teams($(d genius), $(d probe-league), $(d 'Probe League'), $(d 2025-26), $(d men),
    $(d '[{"id":"pp-9911","name":"Probe A","clubId":"probe-pa"},{"id":"pp-9914","name":"Probe D","clubId":"probe-pd"}]'));
  SELECT sync_league_teams($(d genius), $(d probe-league), $(d 'Probe League'), $(d 2026-27), $(d men),
    $(d '[{"id":"pp-9901","name":"Probe A","clubId":"probe-pa"},{"id":"pp-9902","name":"Probe B","clubId":"probe-pb"},{"id":"pp-9903","name":"Probe C","clubId":"probe-pc"}]'));
  INSERT INTO genius_fixture_cache (competition_id, payload)
    VALUES (990000001, $(d "$FIXTURES")::jsonb), (990000002, $(d "$FIXTURES_OLD")::jsonb);
  INSERT INTO space_team_choices (user_id, org_id, league_team_id) VALUES ($(d $W), $PW, $(team pp-9901));"

# The season pass is off since 2026-10-23; probes of the pass offer turn it on.
PASS_ON="INSERT INTO app_config (key, value) VALUES ($(d season_pass_enabled), $(d true))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;"
PASS_OFF="UPDATE app_config SET value = $(d false) WHERE key = $(d season_pass_enabled);"
NO_TEAM="DELETE FROM space_team_choices WHERE user_id = $(d $W);"
PAST_PRO="INSERT INTO stripe_customers (email, stripe_customer_id, subscription_id, subscription_status, plan_name)
    VALUES ($(d probe-pass@example.invalid), $(d cus_probe), $(d sub_probe), $(d canceled), $(d pro));"
ADMIN="UPDATE profiles SET is_platform_admin = true WHERE id = $(d $W);"
SWITCH_LATER="UPDATE app_config SET value = (now() + interval '1 hour')::text WHERE key = $(d free_games_two_since);"
SINGLE="INSERT INTO purchases (user_id, kind, source) VALUES ($(d $W), $(d single_game), $(d admin));"
PASS_A="INSERT INTO purchases (id, user_id, kind, source) VALUES ($(d $PUR), $(d $W), $(d season_pass), $(d admin));
  INSERT INTO season_passes (id, user_id, purchase_id, season_id, league_team_id)
    VALUES ($(d $SP), $(d $W), $(d $PUR), $(d 2026-27), $(team pp-9901));"
STRIPE_PASS_A="INSERT INTO purchases (id, user_id, kind, source, stripe_checkout_session_id, stripe_payment_intent_id)
    VALUES ($(d $PUR), $(d $W), $(d season_pass), $(d stripe), $(d cs_probe), $(d pi_probe));
  INSERT INTO season_passes (id, user_id, purchase_id, season_id, league_team_id)
    VALUES ($(d $SP), $(d $W), $(d $PUR), $(d 2026-27), $(team pp-9901));"
CLUB="INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d franchise));"
NT="INSERT INTO organizations (id, name, plan_tier, is_nt_org) VALUES ($(d $N), $(d 'Probe NT'), $(d franchise), true);
  INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $W), $(d $N), $(d coach));"

imp() {  # $1=match id  $2=game key  [$3=org expr]  [$4=league id]
  printf "INSERT INTO matches (id, user_id, title, org_id, source_game_id, league_id, season_id) VALUES (\$\$%s\$\$, \$\$%s\$\$, \$\$Probe\$\$, %s, \$\$%s\$\$, \$\$%s\$\$, \$\$2026-27\$\$);" \
    "$1" "$W" "${3:-$PW}" "$2" "${4:-probe-league}"
}
via() { printf "SELECT count(*) AS n FROM import_log WHERE user_id = \$\$%s\$\$ AND game_key = \$\$%s\$\$ AND via = \$\$%s\$\$" "$W" "$1" "$2"; }
ACCESS="get_my_player_access()"

echo "# Free trial"
run "a new account gets 2 free games"                                  "ALLOWED rows=2" "SELECT ($ACCESS->>'trial_left')::int AS n" "$SEED"
run "an account from before the switch keeps 3"                        "ALLOWED rows=3" "SELECT ($ACCESS->>'trial_left')::int AS n" "$SEED $SWITCH_LATER"
run "a switch date that isn't a date counts as unset: 3"               "ALLOWED rows=3" "SELECT ($ACCESS->>'trial_left')::int AS n" "$SEED UPDATE app_config SET value = $(d not-a-date) WHERE key = $(d free_games_two_since);"
run "two free games are logged as trial"                               "ALLOWED rows=2" "$(imp m1 9900000002) $(imp m2 9900000004) SELECT count(*) AS n FROM import_log WHERE user_id = $(d $W) AND via = $(d trial)" "$SEED"
run "the third game is refused"                                        "RAISES:import_limit_reached" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) SELECT 1 AS n" "$SEED"
run "the old meter agrees: 0 of 2 left"                                "ALLOWED rows=0" "$(imp m1 9900000002) $(imp m2 9900000004) SELECT (get_import_quota($PW)->>'remaining')::int AS n" "$SEED"

echo "# Single games"
run "a bought single pays for the third game"                          "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) $(via 9900000005 single)" "$SEED $SINGLE"
run "a single needs no team"                                         "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) $(via 9900000005 single)" "$SEED $NO_TEAM $SINGLE"
run "…and the fourth is refused"                                       "RAISES:import_limit_reached" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) $(imp m4 9900000011) SELECT 1 AS n" "$SEED $SINGLE"
run "the old meter counts the single: 1 of 3 left"                     "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) SELECT (get_import_quota($PW)->>'remaining')::int AS n" "$SEED $SINGLE"
run "an expired refill grant never eats a bought single"               "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) RESET ROLE; UPDATE import_grants SET expires_at = now() - interval '1 second' WHERE user_id = $(d $W); INSERT INTO purchases (user_id, kind, source) VALUES ($(d $W), $(d single_game), $(d admin)); SET LOCAL ROLE authenticated; $(imp m4 9900000011) $(via 9900000011 single)" "$SEED INSERT INTO import_grants (user_id, amount, reason, expires_at, created_by) VALUES ($(d $W), 1, $(d free_refill), now() + interval '1 hour', $(d $W));"

echo "# Season pass"
run "a pass covers its team's home game"                               "ALLOWED rows=1" "$(imp m1 9900000001) $(via 9900000001 season_pass)" "$SEED $PASS_A"
run "…and its away game"                                               "ALLOWED rows=1" "$(imp m1 9900000003) $(via 9900000003 season_pass)" "$SEED $PASS_A"
run "…without using a free game"                                       "ALLOWED rows=2" "$(imp m1 9900000001) $(imp m2 9900000003) SELECT ($ACCESS->>'trial_left')::int AS n" "$SEED $PASS_A"
run "a pass doesn't cover other teams' games"                          "ALLOWED rows=1" "$(imp m1 9900000002) $(via 9900000002 trial)" "$SEED $PASS_A"
run "with a pass, another team's game still takes a bought single"     "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) $(via 9900000005 single)" "$SEED $PASS_A $SINGLE"
run "a 2026/27 pass doesn't cover the club's 2025/26 game"             "ALLOWED rows=1" "$(imp m1 9900000011) $(via 9900000011 trial)" "$SEED $PASS_A"
run "a pass holder's old meter shows no limit"                         "ALLOWED rows=1" "SELECT CASE WHEN get_import_quota($PW)->>'remaining' IS NULL THEN 1 ELSE 0 END AS n" "$SEED $PASS_A"
run "a refunded pass stops covering new games"                         "ALLOWED rows=1" "$(imp m1 9900000001) $(via 9900000001 trial)" "$SEED $STRIPE_PASS_A SELECT refund_player_purchase($(d pi_probe));"
run "re-importing a deleted game is free"                              "ALLOWED rows=1" "$(imp m1 9900000002) DELETE FROM matches WHERE id = $(d m1); $(imp m1b 9900000002) SELECT count(*) AS n FROM import_log WHERE user_id = $(d $W)" "$SEED"

echo "# Moving a pass"
run "move the pass once, to another team in the season"                "ALLOWED rows=1" "SELECT CASE WHEN (move_season_pass($(d $SP), $(team pp-9902))->>'moved')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_A"
run "a second move is refused"                                         "RAISES:no_moves_left" "SELECT move_season_pass($(d $SP), $(team pp-9902)); SELECT move_season_pass($(d $SP), $(team pp-9903))" "$SEED $PASS_A"
run "moving to a team outside the season is refused"                   "RAISES:team_not_in_season" "SELECT move_season_pass($(d $SP), $(team pp-9914))" "$SEED $PASS_A"
run "moving someone else's pass is refused"                            "RAISES:not_found" "SELECT move_season_pass($(d 00000000-0000-4000-8000-00000000dead), $(team pp-9902))" "$SEED $PASS_A"
run "after the move the new team's games are covered"                  "ALLOWED rows=1" "SELECT move_season_pass($(d $SP), $(team pp-9902)); $(imp m1 9900000002) $(via 9900000002 season_pass)" "$SEED $PASS_A"
run "…the old team's new games are not"                                "ALLOWED rows=1" "SELECT move_season_pass($(d $SP), $(team pp-9902)); $(imp m1 9900000003) $(via 9900000003 trial)" "$SEED $PASS_A"
run "…and a game imported before the move re-imports free"             "ALLOWED rows=1" "$(imp m1 9900000003) SELECT move_season_pass($(d $SP), $(team pp-9902)); DELETE FROM matches WHERE id = $(d m1); $(imp m1b 9900000003) SELECT count(*) AS n FROM import_log WHERE user_id = $(d $W)" "$SEED $PASS_A"

echo "# Access check (badges and the purchase sheet)"
run "pass switched on: own team's game has the pass on offer"           "ALLOWED rows=1" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000001))->>'pass_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_ON"
run "pass switched off: no pass on offer, own team or not"             "ALLOWED rows=0" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000001))->>'pass_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_OFF"
run "pass switched off: the access says so"                            "ALLOWED rows=0" "SELECT CASE WHEN ($ACCESS->>'pass_enabled')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_OFF"
run "pass switched off: singles stay on offer"                         "ALLOWED rows=1" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000002))->>'single_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_OFF"
run "other teams' game: no pass on offer"                              "ALLOWED rows=0" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000002))->>'pass_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_ON"
run "holding the pass: no second pass on offer"                        "ALLOWED rows=0" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000001))->>'pass_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PASS_ON $PASS_A"
run "holding the pass: the game reads as covered"                      "ALLOWED rows=1" "SELECT CASE WHEN check_game_access($PW, $(d 9900000001))->>'via' = $(d season_pass) THEN 1 ELSE 0 END AS n" "$SEED $PASS_A"
run "sales off: no single on offer"                                    "ALLOWED rows=0" "SELECT CASE WHEN (check_game_access($PW, $(d 9900000002))->>'single_available')::boolean THEN 1 ELSE 0 END AS n" "$SEED UPDATE app_config SET value = $(d false) WHERE key = $(d player_pass_enabled);"
run "the check needs membership of the space"                          "RAISES:not_member" "SELECT check_game_access($(d $K), $(d 9900000001))" "$SEED $CLUB"
run "the team's season games are counted for the sheet"                "ALLOWED rows=2" "SELECT ($ACCESS->'team'->>'games_in_season')::int AS n" "$SEED"

echo "# Purchases"
FULFIL="SELECT fulfill_player_purchase($(d cs_probe_1), $(d $W), $(d single_game), 1, 12900, $(d sek), $(d pi_probe_1), NULL)"
ROLE=service_role run "the service role fulfils a purchase"           "ALLOWED rows=1" "$FULFIL; SELECT count(*) AS n FROM purchases WHERE user_id = $(d $W)" "$SEED"
ROLE=service_role run "fulfilling the same session twice records one" "ALLOWED rows=1" "$FULFIL; $FULFIL; SELECT count(*) AS n FROM purchases WHERE user_id = $(d $W)" "$SEED"
ROLE=service_role run "a paid pass is fulfilled even while it's off"  "ALLOWED rows=1" "SELECT fulfill_player_purchase($(d cs_probe_2), $(d $W), $(d season_pass), 1, 79900, $(d sek), $(d pi_probe_2), NULL, $(d 2026-27), $(team pp-9901)); SELECT count(*) AS n FROM season_passes WHERE user_id = $(d $W) AND status = $(d active)" "$SEED $PASS_OFF"
run "a user can't fulfil their own purchase"                           "DENIED" "$FULFIL" "$SEED"
run "a user can't refund"                                              "DENIED" "SELECT refund_player_purchase($(d pi_probe))" "$SEED $STRIPE_PASS_A"
run "a user can't write a purchase"                                    "DENIED" "INSERT INTO purchases (user_id, kind, source) VALUES ($(d $W), $(d single_game), $(d admin))" "$SEED"
run "a user can't write a season pass"                                 "DENIED" "INSERT INTO season_passes (user_id, purchase_id, season_id, league_team_id) VALUES ($(d $W), $(d $PUR), $(d 2026-27), $(team pp-9901))" "$SEED $PASS_A"
run "a user can't change their own purchase"                           "DENIED" "UPDATE purchases SET status = $(d refunded) WHERE user_id = $(d $W)" "$SEED $SINGLE"
run "a user reads their own purchases"                                 "ALLOWED rows=1" "SELECT count(*) AS n FROM purchases" "$SEED $SINGLE"
ROLE=anon run "anon can't read purchases"                             "DENIED" "SELECT count(*) AS n FROM purchases" "$SEED $SINGLE"
ROLE=anon run "anon can't read season passes"                         "DENIED" "SELECT count(*) AS n FROM season_passes" "$SEED $PASS_A"
ROLE=anon run "anon can't read anyone's access"                       "DENIED" "SELECT get_my_player_access()" "$SEED"
run "an admin grant needs a platform admin"                            "RAISES:not_admin" "SELECT admin_grant_player_purchase($(d probe-pass@example.invalid), $(d single_game))" "$SEED"
run "any purchase marks the account as paid"                           "ALLOWED rows=1" "SELECT CASE WHEN ($ACCESS->>'has_paid')::boolean THEN 1 ELSE 0 END AS n" "$SEED $SINGLE"
run "a past Pro subscription doesn't mark the account as paid"         "ALLOWED rows=0" "SELECT CASE WHEN ($ACCESS->>'has_paid')::boolean THEN 1 ELSE 0 END AS n" "$SEED $PAST_PRO"
run "a customer row without a subscription doesn't"                    "ALLOWED rows=0" "SELECT CASE WHEN ($ACCESS->>'has_paid')::boolean THEN 1 ELSE 0 END AS n" "$SEED INSERT INTO stripe_customers (email, stripe_customer_id) VALUES ($(d probe-pass@example.invalid), $(d cus_probe));"
run "an admin can grant a single"                                      "ALLOWED rows=1" "SELECT admin_grant_player_purchase($(d probe-pass@example.invalid), $(d single_game)); SELECT count(*) AS n FROM purchases WHERE user_id = $(d $W)" "$SEED $ADMIN"
run "an admin can't grant a pass while it's switched off"              "RAISES:pass_not_offered" "SELECT admin_grant_player_purchase($(d probe-pass@example.invalid), $(d season_pass), 1, $(team pp-9901))" "$SEED $PASS_OFF $ADMIN"

echo "# Hardening"
run "re-saving a game with the same source id passes"                  "ALLOWED rows=1" "$(imp m1 9900000002) INSERT INTO matches (id, user_id, title, source_game_id) VALUES ($(d m1), $(d $W), $(d 'Probe again'), $(d 9900000002)) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, source_game_id = EXCLUDED.source_game_id; SELECT count(*) AS n FROM matches WHERE id = $(d m1) AND title = $(d 'Probe again')" "$SEED"
run "a saved game can't become another game"                           "RAISES:game_locked" "$(imp m1 9900000002) UPDATE matches SET source_game_id = $(d 9900000004) WHERE id = $(d m1)" "$SEED"
run "a legacy game without a source id may get one"                    "ALLOWED rows=1" "WITH u AS (UPDATE matches SET source_game_id = $(d 9900000004) WHERE id = $(d legacy1) RETURNING 1) SELECT count(*) AS n FROM u" "$SEED INSERT INTO matches (id, user_id, title) VALUES ($(d legacy1), $(d $W), $(d Legacy));"
run "importing into a club you're not in is refused"                   "RAISES:not_allowed_to_import" "$(imp m1 9900000002 "$(d $K)")" "$SEED $CLUB"
run "importing into a club where you play is refused"                  "RAISES:not_allowed_to_import" "$(imp m1 9900000002 "$(d $K)")" "$SEED $CLUB INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $W), $(d $K), $(d player));"
run "importing into a club you coach is allowed (and unlimited)"       "ALLOWED rows=1" "$(imp m1 9900000002 "$(d $K)") $(via 9900000002 plan)" "$SEED $CLUB INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $W), $(d $K), $(d coach));"
run "a national-team game in your own space counts"                    "ALLOWED rows=1" "$(imp m1 9900000002 "$PW" sweden-national-men) $(via 9900000002 trial)" "$SEED"
run "a national-team game in a national-team space is exempt"          "ALLOWED rows=1" "$(imp m1 9900000002 "$(d $N)" sweden-national-men) $(via 9900000002 exempt)" "$SEED $NT"

echo "# Free refills"
run "a non-buyer who used every free game is a refill candidate"       "ALLOWED rows=1" "$(imp m1 9900000002) $(imp m2 9900000004) RESET ROLE; SELECT count(*) AS n FROM _free_refill_rows() WHERE user_id = $(d $W)" "$SEED"
run "a buyer who used every game is not"                                "ALLOWED rows=0" "$(imp m1 9900000002) $(imp m2 9900000004) $(imp m3 9900000005) RESET ROLE; SELECT count(*) AS n FROM _free_refill_rows() WHERE user_id = $(d $W)" "$SEED $SINGLE"

if [[ $FAILED -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
