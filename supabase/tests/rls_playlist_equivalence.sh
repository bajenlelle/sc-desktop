#!/usr/bin/env bash
#
# RLS equivalence harness for the playlist read path.
#
# Captures, for a set of real fixture users, exactly which rows each one can
# SELECT from every table whose policies the consolidation migration touches.
# Run it BEFORE the migration to record a baseline, then again AFTER, and diff:
#
#   supabase/tests/rls_playlist_equivalence.sh > /tmp/rls-before.txt
#   npx supabase db push
#   supabase/tests/rls_playlist_equivalence.sh > /tmp/rls-after.txt
#   diff /tmp/rls-before.txt /tmp/rls-after.txt && echo IDENTICAL
#
# Any difference means the rewrite changed who can see what — that is a release
# blocker, not a diff to eyeball.
#
# Each user's visible set is reduced to (count, md5 of the ordered id list) so
# the output stays diffable while staying exact: one row appearing or
# disappearing changes the digest.
#
# Read-only by construction: every statement runs inside BEGIN READ ONLY and
# ends in ROLLBACK, and the role is set with SET LOCAL.
set -euo pipefail

cd "$(dirname "$0")/../.."

# ---------------------------------------------------------------------------
# CLI resolution
# ---------------------------------------------------------------------------
# `npx --yes supabase@latest` re-resolves the package on every call, which
# dominates runtime when the probe runs once per fixture user. An older CLI on
# PATH may predate `db query` entirely (homebrew's 2.78 does). So gather
# candidates and pick the first that actually supports the subcommand.
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
SUPABASE_BIN="$(pick_supabase || true)"
if [[ -z "$SUPABASE_BIN" ]]; then
  echo "No supabase CLI with 'db query' found. Update it or set SUPABASE_BIN." >&2
  echo "  npx supabase@latest --version   # populates the npx cache" >&2
  exit 1
fi
echo "# cli: $SUPABASE_BIN" >&2

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
# Chosen to cover every branch of the policies being merged. Kept as literal
# ids (not a query) so the baseline and the re-run compare the same people even
# if the data shifts underneath.
USERS=(
  "5dc28ee0-0186-4ca5-9e8d-9023d4794a92:owner_heavy+platform_admin+share_sender"
  "6a2f2520-f891-48ca-bfc4-1964a54b1513:owner+team_member+share_sender"
  "c1bdd26d-d98b-488f-a666-f2958d8d1162:owner_many+team_member"
  "66a4f9c7-e4ba-40c2-98e7-8bf792641241:multi_org+owner+user_share_recipient"
  "b325c7c5-57dd-43fe-b725-ad4a6874cbfa:pure_user_share_recipient+team_member"
  "c967516d-a7ce-4dfd-9fa6-6800d0e0e45a:user_share_recipient+team_member"
  "680b156d-4165-4f0f-9106-173f4e9ac73f:multi_org_player_no_playlists"
  "33b25ddf-db19-47f5-83c8-9d5af5af7212:team_member_only"
  "fe7b1459-1614-473b-8145-a34072315ead:multi_org+owner+team_member"
  "d5fa1ef3-71e1-4524-b7e9-af63334702fe:platform_admin_only"
  "00000000-0000-0000-0000-000000000000:unrelated_must_see_nothing"
)

# ---------------------------------------------------------------------------
# Probe
# ---------------------------------------------------------------------------
# org_memberships is deliberately absent here: reading it as `authenticated`
# raises "infinite recursion detected in policy for relation org_memberships" —
# om_admin_read is a self-referential EXISTS on its own table. No client path
# hits it today (get_my_orgs and get_org_members are SECURITY DEFINER, and
# delete-account uses the service role), which is why it stayed invisible. The
# consolidation migration fixes it with a definer helper;
# --check-org-memberships verifies that separately, since a table that errors
# before and succeeds after cannot belong in a must-be-identical diff.
#
# matches.id is text; clip_views has a composite key, so its digest
# concatenates the key columns.
read -r -d '' PROBE <<'SQL' || true
SELECT $$playlists$$ AS t, count(*) AS n, coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) AS h FROM playlists
UNION ALL SELECT $$playlist_clips$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM playlist_clips
UNION ALL SELECT $$playlist_folders$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM playlist_folders
UNION ALL SELECT $$playlist_shares$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM playlist_shares
UNION ALL SELECT $$playlist_user_shares$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM playlist_user_shares
UNION ALL SELECT $$matches$$, count(*), coalesce(md5(string_agg(id, $$,$$ ORDER BY id)), $$-$$) FROM matches
UNION ALL SELECT $$play_by_play_events$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM play_by_play_events
UNION ALL SELECT $$clip_views$$, count(*), coalesce(md5(string_agg(user_id::text||playlist_id::text||match_id||event_id::text, $$,$$ ORDER BY user_id, playlist_id, match_id, event_id)), $$-$$) FROM clip_views
UNION ALL SELECT $$team_members$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM team_members
UNION ALL SELECT $$profiles$$, count(*), coalesce(md5(string_agg(id::text, $$,$$ ORDER BY id)), $$-$$) FROM profiles
ORDER BY 1
SQL

# Wrap a probe body so it runs as one authenticated user, read-only.
as_user_sql() {  # $1 = uid, $2 = body
  printf 'BEGIN READ ONLY; SELECT set_config($$request.jwt.claims$$, $${"sub":"%s","role":"authenticated"}$$, true); SET LOCAL ROLE authenticated; %s; ROLLBACK;' "$1" "$2"
}

echo "# RLS equivalence snapshot — visible row sets per fixture user"
echo "# columns: user_label | table | visible_count | md5(ordered ids)"

for entry in "${USERS[@]}"; do
  uid="${entry%%:*}"
  label="${entry#*:}"
  "$SUPABASE_BIN" db query --linked "$(as_user_sql "$uid" "$PROBE")" </dev/null 2>/dev/null \
    | LABEL="$label" python3 -c '
import sys, json, re, os
raw = sys.stdin.read()
label = os.environ["LABEL"]
m = re.search(r"\{.*\}", raw, re.S)
if not m:
    print(f"{label:<44} QUERY_FAILED"); sys.exit(0)
rows = json.loads(m.group(0)).get("rows") or []
if not rows:
    print(f"{label:<44} NO_ROWS"); sys.exit(0)
for r in rows:
    t, n, h = r["t"], r["n"], r["h"]
    print(f"{label:<44} {t:<22} {str(n):>7}  {h}")
'
done

# ---------------------------------------------------------------------------
# Separate: org_memberships readability (errors by design before the migration)
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--check-org-memberships" ]]; then
  echo ""
  echo "# org_memberships readability (RECURSION_ERROR before the RLS migration, a count after)"
  for entry in "${USERS[@]}"; do
    uid="${entry%%:*}"
    label="${entry#*:}"
    out="$("$SUPABASE_BIN" db query --linked "$(as_user_sql "$uid" 'SELECT count(*) AS n FROM org_memberships')" </dev/null 2>&1 || true)"
    if grep -q "infinite recursion" <<<"$out"; then
      printf "%-44s RECURSION_ERROR\n" "$label"
    else
      n="$(grep -o '"n": *[0-9]*' <<<"$out" | head -1 | grep -o '[0-9]*' || true)"
      printf "%-44s visible=%s\n" "$label" "${n:-?}"
    fi
  done
fi
