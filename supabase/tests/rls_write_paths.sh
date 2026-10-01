#!/usr/bin/env bash
#
# Write-path checks for the consolidated playlist RLS.
#
# 20260905100000 replaced two `FOR ALL` policies (playlist_clips_owner,
# events_owner) with explicit SELECT/INSERT/UPDATE/DELETE policies. The
# equivalence harness next door only proves reads are unchanged — this proves
# writes are still owner-scoped, which is what importing a game and editing a
# playlist depend on.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed.
#
#   supabase/tests/rls_write_paths.sh
#
# Fixture ids are resolved at runtime, so this keeps working as data changes.
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

# The actor: a coach who owns playlists and matches.
U="${RLS_TEST_USER:-5dc28ee0-0186-4ca5-9e8d-9023d4794a92}"

echo "# Resolving fixtures for $U ..."
FIX="$("$BIN" db query --linked "
SELECT
  (SELECT pc.id::text FROM playlist_clips pc JOIN playlists p ON p.id=pc.playlist_id WHERE p.user_id=\$\$$U\$\$ LIMIT 1) AS owned_clip,
  (SELECT p.id::text FROM playlists p WHERE p.user_id=\$\$$U\$\$ LIMIT 1) AS owned_playlist,
  (SELECT pc.id::text FROM playlist_clips pc JOIN playlists p ON p.id=pc.playlist_id WHERE p.user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_clip,
  (SELECT p.id::text FROM playlists p WHERE p.user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_playlist,
  (SELECT id FROM matches WHERE user_id=\$\$$U\$\$ LIMIT 1) AS owned_match,
  (SELECT id FROM matches WHERE user_id<>\$\$$U\$\$ LIMIT 1) AS foreign_match" </dev/null 2>/dev/null \
 | python3 -c '
import sys, json, re
m = re.search(r"\{.*\}", sys.stdin.read(), re.S)
r = json.loads(m.group(0))["rows"][0]
missing = [k for k, v in r.items() if not v]
if missing:
    sys.stderr.write(f"missing fixtures: {missing}\n"); sys.exit(1)
for k, v in r.items():
    print(f"{k}={v}")
')"
eval "$FIX"
echo "$FIX" | sed 's/^/#   /'

# Optional: RLS_PREFLIGHT=<migration.sql> applies an UNPUSHED migration inside
# every probe's transaction. DDL is transactional in Postgres, so a policy or
# trigger change is proven against real prod data before `db push` — and, like
# everything else here, rolled back.
PREFLIGHT=""
if [[ -n "${RLS_PREFLIGHT:-}" ]]; then
  PREFLIGHT="$(cat "$RLS_PREFLIGHT")"$'\n;'
  echo "# Preflight: $RLS_PREFLIGHT applied inside every probe (rolled back)"
fi

FAILED=0
run() {  # $1=label  $2=expected  $3=sql as the actor  [$4=privileged setup sql, ending in ;]
  # expected: ALLOWED | DENIED (RLS) | RAISES:<token> (guard) | BLOCKED (either)
  # The actor is $U unless ACTOR is set (the escalation section needs a user
  # who is not a platform admin).
  local out got st actor="${ACTOR:-$U}"
  out=$("$BIN" db query --linked "BEGIN; $PREFLIGHT ${4:-} SELECT set_config(\$\$request.jwt.claims\$\$, \$\${\"sub\":\"$actor\",\"role\":\"authenticated\"}\$\$, true); SET LOCAL ROLE authenticated; $3; ROLLBACK;" </dev/null 2>&1 || true)
  if grep -q "42501\|violates row-level security" <<<"$out"; then
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
  printf "  %-60s expect=%-32s got=%-34s %s\n" "$1" "$2" "$got" "$st"
}

echo ""
echo "=== playlist_clips writes (must stay owner-only) ==="
run "UPDATE own clip" ALLOWED \
  "WITH u AS (UPDATE playlist_clips SET note=note WHERE id=$owned_clip RETURNING 1) SELECT count(*) AS n FROM u"
run "UPDATE foreign clip (0 rows, no error)" ALLOWED \
  "WITH u AS (UPDATE playlist_clips SET note=note WHERE id=$foreign_clip RETURNING 1) SELECT count(*) AS n FROM u"
run "DELETE own clip" ALLOWED \
  "WITH d AS (DELETE FROM playlist_clips WHERE id=$owned_clip RETURNING 1) SELECT count(*) AS n FROM d"
run "DELETE foreign clip (0 rows)" ALLOWED \
  "WITH d AS (DELETE FROM playlist_clips WHERE id=$foreign_clip RETURNING 1) SELECT count(*) AS n FROM d"
run "INSERT clip -> own playlist" ALLOWED \
  "WITH i AS (INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES (\$\$$owned_playlist\$\$, \$\$$owned_match\$\$, 999999, 9999) RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT clip -> foreign playlist" DENIED \
  "WITH i AS (INSERT INTO playlist_clips (playlist_id, match_id, event_id, position) VALUES (\$\$$foreign_playlist\$\$, \$\$$owned_match\$\$, 999999, 9999) RETURNING 1) SELECT count(*) AS n FROM i"

echo ""
echo "=== play_by_play_events writes (must stay own-matches-only) ==="
run "INSERT event -> own match" ALLOWED \
  "WITH i AS (INSERT INTO play_by_play_events (match_id, event_id, type) VALUES (\$\$$owned_match\$\$, 999999, \$\$test\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "INSERT event -> foreign match" DENIED \
  "WITH i AS (INSERT INTO play_by_play_events (match_id, event_id, type) VALUES (\$\$$foreign_match\$\$, 999999, \$\$test\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "DELETE events of own match" ALLOWED \
  "WITH d AS (DELETE FROM play_by_play_events WHERE match_id=\$\$$owned_match\$\$ RETURNING 1) SELECT count(*) AS n FROM d"
run "DELETE events of foreign match (0 rows)" ALLOWED \
  "WITH d AS (DELETE FROM play_by_play_events WHERE match_id=\$\$$foreign_match\$\$ RETURNING 1) SELECT count(*) AS n FROM d"

# --- Share scope (20260929100000_enforce_share_scope) ----------------------
# Sharing is club-shaped: owner-only, from a club playlist, to members/teams of
# that same club. Run once with RLS_PREFLIGHT pointing at the migration before
# pushing it; without it (or before it is applied) the "blocked" probes show
# the holes it closes. All writes roll back, and pg_net is transactional, so no
# share notification is ever sent.
echo ""
echo "# Resolving share fixtures for $U ..."
SFIX="$("$BIN" db query --linked "
WITH club AS (
  SELECT p.org_id FROM playlists p JOIN organizations o ON o.id=p.org_id
   WHERE p.user_id=\$\$$U\$\$ AND NOT o.is_personal
     AND EXISTS (SELECT 1 FROM teams t WHERE t.org_id=p.org_id)
   GROUP BY p.org_id ORDER BY count(*) DESC LIMIT 1),
cp AS (
  SELECT p.id FROM playlists p, club
   WHERE p.user_id=\$\$$U\$\$ AND p.org_id=club.org_id
   ORDER BY p.created_at DESC LIMIT 1)
SELECT
  (SELECT org_id::text FROM club) AS club_org,
  (SELECT id::text FROM cp) AS club_playlist,
  (SELECT t.id::text FROM teams t, club, cp WHERE t.org_id=club.org_id
    ORDER BY EXISTS (SELECT 1 FROM playlist_shares s WHERE s.playlist_id=cp.id AND s.team_id=t.id) LIMIT 1) AS own_team,
  (SELECT om.user_id::text FROM org_memberships om, club, cp
    WHERE om.org_id=club.org_id AND om.user_id<>\$\$$U\$\$
      AND NOT EXISTS (SELECT 1 FROM playlist_user_shares s WHERE s.playlist_id=cp.id AND s.user_id=om.user_id) LIMIT 1) AS member_r,
  (SELECT u.id::text FROM auth.users u, club
    WHERE NOT EXISTS (SELECT 1 FROM org_memberships om WHERE om.org_id=club.org_id AND om.user_id=u.id) LIMIT 1) AS outsider_x,
  -- An UNLOCKED org's team: a locked one trips trg_enforce_license_on_share first
  -- and would hide the cross-org hole this probe exists to show.
  (SELECT t.id::text FROM teams t, club WHERE t.org_id<>club.org_id
    ORDER BY (org_license_state(t.org_id) = 'locked') LIMIT 1) AS other_team,
  (SELECT p.id::text FROM playlists p, club
    WHERE p.user_id<>\$\$$U\$\$ AND p.org_id IS DISTINCT FROM club.org_id
      AND NOT EXISTS (SELECT 1 FROM playlist_user_shares s WHERE s.playlist_id=p.id AND s.user_id=\$\$$U\$\$) LIMIT 1) AS other_club_playlist,
  (SELECT p.id::text FROM playlists p, club
    WHERE p.user_id<>\$\$$U\$\$ AND p.org_id=club.org_id
      AND NOT EXISTS (SELECT 1 FROM playlist_user_shares s WHERE s.playlist_id=p.id AND s.user_id=\$\$$U\$\$) LIMIT 1) AS colleague_playlist,
  (SELECT o.id::text FROM org_memberships om JOIN organizations o ON o.id=om.org_id
    WHERE om.user_id=\$\$$U\$\$ AND o.is_personal LIMIT 1) AS personal_org" </dev/null 2>/dev/null \
 | python3 -c '
import sys, json
s = sys.stdin.read()
r = json.loads(s[s.index("{"):s.rindex("}") + 1])["rows"][0]
optional = {"colleague_playlist"}
missing = [k for k, v in r.items() if not v and k not in optional]
if missing:
    sys.stderr.write(f"missing share fixtures: {missing}\n"); sys.exit(1)
for k, v in r.items():
    print(k + "=" + (v or ""))
')"
eval "$SFIX"
echo "$SFIX" | sed 's/^/#   /'
TMP_PL="$(uuidgen | tr 'A-Z' 'a-z')"

ushare() {  # $1=playlist $2=recipient -> count of inserted rows
  echo "WITH i AS (INSERT INTO playlist_user_shares (playlist_id, user_id, shared_by) VALUES (\$\$$1\$\$, \$\$$2\$\$, \$\$$U\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
}

echo ""
echo "=== direct shares (owner-only, club-only, recipients in the club) ==="
run "new share: own club playlist -> club member" ALLOWED "$(ushare "$club_playlist" "$member_r")"
run "self-grant: another club's playlist -> me" BLOCKED "$(ushare "$other_club_playlist" "$U")"
if [[ -n "${colleague_playlist:-}" ]]; then
  run "self-grant: club colleague's playlist -> me" DENIED "$(ushare "$colleague_playlist" "$U")"
else
  echo "  (skip) self-grant of a colleague's playlist — no other owner's playlist in the club"
fi
run "new share: own personal playlist -> club member" RAISES:playlist_not_in_club \
  "INSERT INTO playlists (id, user_id, name, org_id) VALUES (\$\$$TMP_PL\$\$, \$\$$U\$\$, \$\$rls probe\$\$, \$\$$personal_org\$\$); $(ushare "$TMP_PL" "$member_r")"
run "new share: own club playlist -> outsider" RAISES:recipient_not_in_org "$(ushare "$club_playlist" "$outsider_x")"
run "re-sync: recipient has since left the club" ALLOWED \
  "WITH i AS (INSERT INTO playlist_user_shares (playlist_id, user_id, shared_by) VALUES (\$\$$club_playlist\$\$, \$\$$member_r\$\$, \$\$$U\$\$) ON CONFLICT (playlist_id, user_id) DO UPDATE SET shared_by = EXCLUDED.shared_by RETURNING 1) SELECT count(*) AS n FROM i" \
  "INSERT INTO playlist_user_shares (playlist_id, user_id, shared_by) VALUES (\$\$$club_playlist\$\$, \$\$$member_r\$\$, \$\$$U\$\$); DELETE FROM org_memberships WHERE org_id=\$\$$club_org\$\$ AND user_id=\$\$$member_r\$\$;"
run "new share while the club's licence is locked" RAISES:license_locked \
  "$(ushare "$club_playlist" "$member_r")" \
  "UPDATE organizations SET expires_at = now() - interval '60 days' WHERE id=\$\$$club_org\$\$;"

echo ""
echo "=== team shares and the legacy playlists.team_id channel (same club only) ==="
run "team share: own club playlist -> own club's team" ALLOWED \
  "WITH i AS (INSERT INTO playlist_shares (playlist_id, team_id) VALUES (\$\$$club_playlist\$\$, \$\$$own_team\$\$) ON CONFLICT (playlist_id, team_id) DO NOTHING RETURNING 1) SELECT count(*) AS n FROM i"
run "team share: own club playlist -> another org's team" RAISES:team_not_in_playlist_org \
  "WITH i AS (INSERT INTO playlist_shares (playlist_id, team_id) VALUES (\$\$$club_playlist\$\$, \$\$$other_team\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "team_id: own club playlist -> own club's team" ALLOWED \
  "WITH u AS (UPDATE playlists SET team_id=\$\$$own_team\$\$ WHERE id=\$\$$club_playlist\$\$ RETURNING 1) SELECT count(*) AS n FROM u"
run "team_id: own club playlist -> another org's team" RAISES:team_not_in_playlist_org \
  "WITH u AS (UPDATE playlists SET team_id=\$\$$other_team\$\$ WHERE id=\$\$$club_playlist\$\$ RETURNING 1) SELECT count(*) AS n FROM u"

# --- Self-escalation (20260929120000_close_self_escalation) ----------------
# A client must not write the rows its privileges come from. The actor is an
# ordinary user: no platform admin, no club, no team. Before that migration the
# DENIED probes here come back ALLOWED rows=1, which is the hole.
echo ""
echo "# Resolving escalation fixtures ..."
EFIX="$("$BIN" db query --linked "
WITH p AS (
  SELECT pr.id FROM profiles pr
   WHERE NOT pr.is_platform_admin AND pr.org_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM org_memberships om JOIN organizations o ON o.id=om.org_id
                      WHERE om.user_id=pr.id AND NOT o.is_personal)
     AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id=pr.id)
   ORDER BY pr.created_at LIMIT 1),
fc AS (
  SELECT t.org_id, t.id AS team_id FROM teams t JOIN organizations o ON o.id=t.org_id
   WHERE NOT o.is_personal
   ORDER BY EXISTS (SELECT 1 FROM playlist_shares s WHERE s.team_id=t.id) DESC LIMIT 1)
SELECT
  (SELECT id::text FROM p) AS plain_user,
  (SELECT org_id::text FROM fc) AS foreign_club,
  (SELECT team_id::text FROM fc) AS foreign_team" </dev/null 2>/dev/null \
 | python3 -c '
import sys, json
s = sys.stdin.read()
r = json.loads(s[s.index("{"):s.rindex("}") + 1])["rows"][0]
missing = [k for k, v in r.items() if not v]
if missing:
    sys.stderr.write(f"missing escalation fixtures: {missing}\n"); sys.exit(1)
for k, v in r.items():
    print(k + "=" + v)
')"
eval "$EFIX"
echo "$EFIX" | sed 's/^/#   /'

echo ""
echo "=== self-escalation (profiles, memberships, orgs, teams) ==="
ACTOR="$plain_user"
run "profile prefs: name, avatar, theme, onboarding flags" "ALLOWED rows=1" \
  "WITH u AS (UPDATE profiles SET full_name=full_name, avatar_url=avatar_url, declared_role=declared_role, celebrated_plan_tier=celebrated_plan_tier, onboarding_checklist_dismissed_at=onboarding_checklist_dismissed_at, welcome_dismissed_at=welcome_dismissed_at, theme_dark=theme_dark, theme_light=theme_light, theme_mode=theme_mode WHERE id=auth.uid() RETURNING 1) SELECT count(*) AS n FROM u"
run "profile: self-promote to platform admin" DENIED \
  "WITH u AS (UPDATE profiles SET is_platform_admin=true WHERE id=auth.uid() RETURNING 1) SELECT count(*) AS n FROM u"
run "profile: claim admin of a foreign club (org_id + role)" DENIED \
  "WITH u AS (UPDATE profiles SET org_id=\$\$$foreign_club\$\$, role=\$\$admin\$\$ WHERE id=auth.uid() RETURNING 1) SELECT count(*) AS n FROM u"
run "team_members: join a foreign club's team directly" DENIED \
  "WITH i AS (INSERT INTO team_members (team_id, user_id, role) VALUES (\$\$$foreign_team\$\$, auth.uid(), \$\$player\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
run "organizations: insert an org directly" DENIED \
  "WITH i AS (INSERT INTO organizations (name) VALUES (\$\$rls probe\$\$) RETURNING 1) SELECT count(*) AS n FROM i"
# As the club's primary admin (profiles.role = 'admin'), which the dropped
# policies trusted. An UPDATE no policy covers matches 0 rows, not an error.
PRIMARY_ADMIN="UPDATE profiles SET org_id=\$\$$foreign_club\$\$, role=\$\$admin\$\$ WHERE id=\$\$$plain_user\$\$;"
run "organizations: primary admin rewrites its licence (0 rows)" "ALLOWED rows=0" \
  "WITH u AS (UPDATE organizations SET expires_at=expires_at WHERE id=\$\$$foreign_club\$\$ RETURNING 1) SELECT count(*) AS n FROM u" \
  "$PRIMARY_ADMIN"
run "teams: primary admin inserts a team directly" DENIED \
  "WITH i AS (INSERT INTO teams (org_id, name) VALUES (\$\$$foreign_club\$\$, \$\$rls probe\$\$) RETURNING 1) SELECT count(*) AS n FROM i" \
  "$PRIMARY_ADMIN"
run "rpc: create_org_for_user" DENIED \
  "SELECT count(create_org_for_user(\$\$rls probe\$\$)) AS n"
# The legitimate way in still works: join_by_code is SECURITY DEFINER, so it
# writes team_members/org_memberships without the dropped policy. Setup gives
# the club an invite (RLSPRB can't collide: real codes are hex) and room on
# its licence, so a locked or full club can't turn this into a false failure.
run "rpc: join a club's team by invite code" "ALLOWED rows=1" \
  "SELECT count(join_by_code(\$\$RLSPRB\$\$)) AS n" \
  "INSERT INTO team_invites (team_id, code, role, created_by) VALUES (\$\$$foreign_team\$\$, \$\$RLSPRB\$\$, \$\$player\$\$, \$\$$U\$\$); UPDATE organizations SET expires_at = now() + interval '1 year', player_seat_limit = NULL WHERE id=\$\$$foreign_club\$\$;"
unset ACTOR

# --- Invite codes (20260930100000_lock_down_invites) ------------------------
# Staff read their own org's invites; everyone else reads none. Invites are
# created only through the RPCs. An emailed admin/coach invite works only for
# its address; a link without an email stays shareable. Probe codes contain
# non-hex letters, so they can't collide with real ones.
echo ""
echo "=== invite codes (reads, direct writes, email binding, team scope) ==="
ROOM="UPDATE organizations SET expires_at = now() + interval '1 year', coach_seat_limit = NULL, player_seat_limit = NULL WHERE id=\$\$$foreign_club\$\$;"
invite() {  # $1=code $2=role $3=email-or-NULL -> privileged insert of an org invite into foreign_club
  echo "INSERT INTO org_invites (org_id, code, role, email, created_by, max_uses, expires_at) VALUES (\$\$$foreign_club\$\$, \$\$$1\$\$, \$\$$2\$\$, $3, \$\$$U\$\$, 1, now() + interval '7 days');"
}
ACTOR="$plain_user"
run "org_invites: read as a non-member (0 rows)" "ALLOWED rows=0" \
  "SELECT count(*) AS n FROM org_invites"
run "team_invites: read others' as a non-member (0 rows)" "ALLOWED rows=0" \
  "SELECT count(*) AS n FROM team_invites WHERE created_by <> auth.uid()"
run "org_invites: coach inserts an admin invite directly" DENIED \
  "WITH i AS (INSERT INTO org_invites (org_id, code, role, created_by) VALUES (\$\$$foreign_club\$\$, \$\$RLSPRC\$\$, \$\$admin\$\$, auth.uid()) RETURNING 1) SELECT count(*) AS n FROM i" \
  "INSERT INTO org_memberships (user_id, org_id, role) VALUES (\$\$$plain_user\$\$, \$\$$foreign_club\$\$, \$\$coach\$\$);"
run "team_invites: team member inserts an invite directly" DENIED \
  "WITH i AS (INSERT INTO team_invites (team_id, code, role, created_by) VALUES (\$\$$foreign_team\$\$, \$\$RLSPRD\$\$, \$\$coach\$\$, auth.uid()) RETURNING 1) SELECT count(*) AS n FROM i" \
  "INSERT INTO team_members (team_id, user_id, role) VALUES (\$\$$foreign_team\$\$, \$\$$plain_user\$\$, \$\$player\$\$);"
run "join: emailed coach invite sent to another address" RAISES:invite_email_mismatch \
  "SELECT count(join_by_code(\$\$RLSPRE\$\$)) AS n" \
  "$(invite RLSPRE coach "\$\$rls-probe@example.invalid\$\$") $ROOM"
run "join: emailed player invite sent to another address" "ALLOWED rows=1" \
  "SELECT count(join_by_code(\$\$RLSPRF\$\$)) AS n" \
  "$(invite RLSPRF player "\$\$rls-probe@example.invalid\$\$") $ROOM"
run "join: coach link without an email" "ALLOWED rows=1" \
  "SELECT count(join_by_code(\$\$RLSPRG\$\$)) AS n" \
  "$(invite RLSPRG coach NULL) $ROOM"
unset ACTOR
run "staff: read own org's invite" "ALLOWED rows=1" \
  "SELECT count(*) AS n FROM org_invites WHERE code=\$\$RLSPRH\$\$" \
  "INSERT INTO org_invites (org_id, code, role, created_by) VALUES (\$\$$club_org\$\$, \$\$RLSPRH\$\$, \$\$player\$\$, \$\$$U\$\$);"
run "rpc: invite link for another org's team" RAISES:team_not_in_org \
  "SELECT count(generate_org_invite(\$\$$club_org\$\$, \$\$player\$\$, NULL, NULL, false, \$\$$other_team\$\$)) AS n"

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "ALL WRITE-PATH CHECKS PASSED (nothing committed)"
else
  echo "WRITE-PATH CHECKS FAILED — do not ship" >&2
  exit 1
fi
