#!/usr/bin/env bash
#
# Checks for the onboarding emails (20261118100000_onboarding_emails.sql).
#
# Confirming an account queues one welcome; the 5-minute cron sends it once it
# is 10 minutes old, unless by then the account came from an invite, joined a
# club or signed in on the phone app (then it's marked skipped, never sent),
# and never once it is a day old. A trigger error never blocks sign-up. The
# email's language is read when it is sent. One reminder follows 2 to 7 days
# after the welcome for accounts with no desktop sign-in that can take
# marketing email. A resend works once per 10 minutes. Everything waits on the
# app_config switch onboarding_emails_enabled. Nobody but the service role
# reads the queue or calls the senders and helpers.
#
# Every statement runs inside BEGIN … ROLLBACK, so nothing is committed, and
# pg_net only sends committed requests: a probe's emails are counted as rows
# in net.http_request_queue and never leave. notify_email_fn_url points at a
# dead host inside every probe as a second guard.
#
#   RLS_PREFLIGHT=supabase/migrations/20261118100000_onboarding_emails.sql supabase/tests/onboarding_emails.sh   # before applying
#   supabase/tests/onboarding_emails.sh                                                                         # after
#
# Runs against the linked project through the CLI, unless SUPABASE_DB_URL is
# set: then every probe runs through psql (e.g. staging through the session
# pooler), because `db query --db-url` sends one prepared statement at a time
# and can't hold a BEGIN … ROLLBACK. The URL is never printed; its password is
# masked out of any output. VERBOSE=1 prints a failing probe's output.
set -euo pipefail
trap 'echo "onboarding_emails.sh: failed at line $LINENO" >&2' ERR

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

# Throwaway accounts that sign up inside every probe (handle_new_user gives
# each a personal space). A confirms at sign-up, as Google and Apple do; B
# signs up with email and hasn't confirmed yet; C only signs up in the probe
# where the queue table is gone.
A="00000000-0000-4000-8000-0000000e0a01"
B="00000000-0000-4000-8000-0000000e0a02"
C="00000000-0000-4000-8000-0000000e0a03"
K="00000000-0000-4000-8000-0000000e0b01"    # a club
EA=probe-welcome-a@example.invalid
EB=probe-welcome-b@example.invalid

SEED="INSERT INTO app_config (key, value) VALUES ('onboarding_emails_enabled', 'true'), ('notify_email_fn_url', 'https://probe.invalid')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO auth.users (id, email, created_at, email_confirmed_at, raw_user_meta_data) VALUES
    ($(d $A), $(d $EA), now(), now(), $(d '{"full_name":"Probe Anna Svensson","declared_role":"coach"}')::jsonb),
    ($(d $B), $(d $EB), now(), NULL, $(d '{"full_name":"Probe B"}')::jsonb);"

# Queue rows that aren't the probe's are set aside, so the senders' counts are
# the probe's alone once the migration is live.
ONLY="DELETE FROM onboarding_emails WHERE user_id NOT IN ($(d $A), $(d $B));"
DUE="$ONLY UPDATE onboarding_emails SET queued_at = now() - interval '11 minutes' WHERE user_id = $(d $A);"
OFF="DELETE FROM app_config WHERE key = 'onboarding_emails_enabled';"
# A's row fails while being built (the data helper is swapped, inside the
# probe only, for one that raises for A); B is due too and must still go out.
BAD_A="$DUE UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B);
  UPDATE onboarding_emails SET queued_at = now() - interval '11 minutes' WHERE user_id = $(d $B);
  CREATE OR REPLACE FUNCTION _onboarding_email_data(p_user uuid, p_kind text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS \$f\$
    BEGIN IF p_user = $(d $A)::uuid THEN RAISE EXCEPTION 'probe_bad_row'; END IF; RETURN '{\"lang\":\"en\"}'::jsonb; END \$f\$;"
SENT3="$ONLY UPDATE onboarding_emails SET queued_at = now() - interval '3 days', sent_at = now() - interval '3 days' WHERE user_id = $(d $A);"
CLUB="INSERT INTO organizations (id, name, plan_tier) VALUES ($(d $K), $(d 'Probe club'), $(d pro));
  INSERT INTO org_memberships (user_id, org_id, role) VALUES ($(d $A), $(d $K), $(d player));"
INVITE="UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || $(d '{"pending_invite":"PROBE123"}')::jsonb WHERE id = $(d $A);"
lang() { printf "UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('lang', %s) WHERE id = %s;" "$(d "$1")" "$(d $A)"; }
device() { printf "INSERT INTO user_devices (user_id, device_id, app) VALUES (%s, gen_random_uuid(), %s);" "$(d $A)" "$(d "$1")"; }

# Requests queued for pg_net with template $1 to A, optionally with a condition
# on the message: `m` is A's entry in the batch.
reqs() {  # reqs template [condition on m]
  printf "SELECT count(*) AS n FROM net.http_request_queue q,
      LATERAL (SELECT CASE WHEN q.url LIKE 'https://probe.invalid/%%' THEN convert_from(q.body, 'UTF8')::jsonb END AS b) j,
      LATERAL jsonb_array_elements(j.b->'batch') m
    WHERE q.url LIKE 'https://probe.invalid/%%' AND j.b->>'template' = %s AND m->>'to' = %s AND (%s)" \
    "$(d "$1")" "$(d $EA)" "${2:-true}"
}
row() {  # row kind condition → 1 if A's row of that kind matches
  printf "SELECT count(*) AS n FROM onboarding_emails WHERE user_id = %s AND kind = %s AND (%s)" "$(d $A)" "$(d "$1")" "$2"
}
W=$A   # the default actor
SVC="RESET ROLE;"
MAC_SV="https://scoutable.se/download/mac?utm_source=welcome_email&utm_medium=email&utm_campaign=onboarding&lang=sv"
WIN_SV="https://scoutable.se/download/windows?utm_source=welcome_email&utm_medium=email&utm_campaign=onboarding&lang=sv"
MAC_REM="https://scoutable.se/download/mac?utm_source=reminder_email&utm_medium=email&utm_campaign=onboarding&lang=en"

echo "# A=$A (confirmed at sign-up)  B=$B (email signup, unconfirmed)"
echo
echo "## Queueing"
run "queue on INSERT confirmed (OAuth)"                                      "ALLOWED rows=1"  "$SVC $(row welcome "sent_at IS NULL AND skipped_reason IS NULL")"
run "queue on UPDATE NULL→now (email confirm)"                               "ALLOWED rows=1"  "$SVC UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B); SELECT count(*) AS n FROM onboarding_emails WHERE user_id = $(d $B) AND kind = 'welcome'"
run "a second NULL→now confirm keeps one row"                               "ALLOWED rows=1"  "$SVC UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B); UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $(d $B); UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B); SELECT count(*) AS n FROM onboarding_emails WHERE user_id = $(d $B)"
run "unconfirmed INSERT queues nothing"                                      "ALLOWED rows=0"  "$SVC SELECT count(*) AS n FROM onboarding_emails WHERE user_id = $(d $B)"
run "confirming an already-confirmed account again queues nothing"        "ALLOWED rows=0"  "$SVC UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B); SELECT count(*) AS n FROM onboarding_emails WHERE user_id = $(d $B)" "UPDATE auth.users SET email_confirmed_at = now() - interval '1 hour' WHERE id = $(d $B); DELETE FROM onboarding_emails WHERE user_id = $(d $B);"
run "a sign-in update of a confirmed account queues nothing"                 "ALLOWED rows=0"  "$SVC UPDATE auth.users SET last_sign_in_at = now() WHERE id = $(d $A); SELECT count(*) AS n FROM onboarding_emails WHERE user_id = $(d $A)" "DELETE FROM onboarding_emails WHERE user_id = $(d $A);"
run "trigger failure never blocks auth"                                      "ALLOWED rows=2"  "$SVC INSERT INTO auth.users (id, email, created_at, email_confirmed_at) VALUES ($(d $C), $(d probe-welcome-c@example.invalid), now(), now()); UPDATE auth.users SET email_confirmed_at = now() WHERE id = $(d $B); SELECT count(*) AS n FROM auth.users WHERE id IN ($(d $B), $(d $C)) AND email_confirmed_at IS NOT NULL" "ALTER TABLE onboarding_emails RENAME TO onboarding_emails_probe_gone;"

echo
echo "## Sending the welcome"
run "hold: 5 minutes old isn't sent"                                         "ALLOWED rows=0"  "$SVC SELECT send_queued_welcomes() AS n" "$ONLY UPDATE onboarding_emails SET queued_at = now() - interval '5 minutes' WHERE user_id = $(d $A);"
run "send: 11 minutes old, personal space only, is sent"                     "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes() AS n" "$DUE"
run "send: the row is marked sent"                                           "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "sent_at IS NOT NULL AND skipped_reason IS NULL")" "$DUE"
run "send: one request with template welcome"                                "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome)" "$DUE"
run "send: language is read at send time"                                    "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'lang' = 'sv'")" "$DUE $(lang sv)"
run "send: first name, role and download links"                              "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'first_name' = 'Anna' AND m->'data'->>'role' = 'coach' AND m->'data'->>'mac_url' = $(d "$MAC_SV") AND m->'data'->>'win_url' = $(d "$WIN_SV") AND NOT (m->'data' ? 'unsubscribe_url')")" "$DUE $(lang sv) UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || $(d '{"full_name":"Anna Svensson"}')::jsonb WHERE id = $(d $A);"
run "send: no name or odd role leaves them out"                              "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "NOT (m->'data' ? 'first_name') AND NOT (m->'data' ? 'role')")" "$DUE UPDATE auth.users SET raw_user_meta_data = $(d '{"declared_role":"parent"}')::jsonb WHERE id = $(d $A); UPDATE profiles SET declared_role = NULL WHERE id = $(d $A);"
run "send: role from the profile when the metadata has none"                 "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'role' = 'player'")" "$DUE UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data - 'declared_role' WHERE id = $(d $A); UPDATE profiles SET declared_role = 'player' WHERE id = $(d $A);"
run "send: the profile's role wins over the metadata's"                      "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'role' = 'player'")" "$DUE UPDATE profiles SET declared_role = 'player' WHERE id = $(d $A);"
run "send: a second run sends nothing more"                                  "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); SELECT send_queued_welcomes(); $(reqs welcome)" "$DUE"
run "lang fallback: de → en"                                                 "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'lang' = 'en'")" "$DUE $(lang de)"
run "lang fallback: none → en"                                               "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(reqs welcome "m->'data'->>'lang' = 'en'")" "$DUE"
run "skip invite"                                                            "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "skipped_reason = 'invite' AND sent_at IS NULL") AND ($(reqs welcome)) = 0" "$DUE $INVITE"
run "skip club"                                                              "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "skipped_reason = 'club' AND sent_at IS NULL") AND ($(reqs welcome)) = 0" "$DUE $CLUB"
run "skip mobile"                                                            "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "skipped_reason = 'mobile' AND sent_at IS NULL") AND ($(reqs welcome)) = 0" "$DUE $(device mobile)"
run "skip reasons go invite, club, mobile"                                   "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "skipped_reason = 'invite'")" "$DUE $CLUB $(device mobile) $INVITE"
run "a skipped account counts as not sent"                                   "ALLOWED rows=0"  "$SVC SELECT send_queued_welcomes() AS n" "$DUE $CLUB"
run "a desktop or web sign-in doesn't skip"                                  "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes() AS n" "$DUE $(device desktop) $(device web)"
run "stale: a day old is never sent"                                         "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "skipped_reason = 'stale' AND sent_at IS NULL") AND ($(reqs welcome)) = 0" "$ONLY UPDATE onboarding_emails SET queued_at = now() - interval '25 hours' WHERE user_id = $(d $A);"
run "switch off: nothing sent"                                               "ALLOWED rows=0"  "$SVC SELECT send_queued_welcomes() AS n" "$DUE $OFF"
run "switch off: rows untouched"                                             "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes(); $(row welcome "sent_at IS NULL AND skipped_reason IS NULL")" "$DUE $OFF"
run "switch at anything but 'true' is off"                                   "ALLOWED rows=0"  "$SVC SELECT send_queued_welcomes() AS n" "$DUE UPDATE app_config SET value = 'yes' WHERE key = 'onboarding_emails_enabled';"
run "one bad row is marked error, the rest still send"                       "ALLOWED rows=2"  "$SVC SELECT send_queued_welcomes(); SELECT count(*) AS n FROM onboarding_emails WHERE kind = 'welcome' AND ((user_id = $(d $A) AND skipped_reason = 'error' AND sent_at IS NULL) OR (user_id = $(d $B) AND sent_at IS NOT NULL))" "$BAD_A"
run "…and the good row's email goes out"                                     "ALLOWED rows=1"  "$SVC SELECT send_queued_welcomes() AS n" "$BAD_A"

echo
echo "## The reminder"
run "reminder once: 3 days after, no desktop"                                "ALLOWED rows=1"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3"
run "reminder: one request, with an unsubscribe link"                        "ALLOWED rows=1"  "$SVC SELECT send_onboarding_reminders(); $(reqs onboarding_reminder "m->'data'->>'unsubscribe_url' LIKE '%/unsubscribe?t=%' AND m->'data'->>'mac_url' = $(d "$MAC_REM")")" "$SENT3"
run "reminder: a second run sends nothing"                                   "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders(); SELECT send_onboarding_reminders() AS n" "$SENT3"
run "reminder: recorded once"                                                "ALLOWED rows=1"  "$SVC SELECT send_onboarding_reminders(); SELECT send_onboarding_reminders(); $(row reminder "sent_at IS NOT NULL")" "$SENT3"
run "reminder skips desktop"                                                 "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 $(device desktop)"
run "reminder skips unsubscribed"                                            "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE email_preferences SET unsubscribed_at = now() WHERE user_id = $(d $A);"
run "reminder skips no consent when consent is required"                     "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE free_refill_settings SET email_requires_consent = true;"
run "reminder skips sent_at 1 day ago"                                       "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE onboarding_emails SET sent_at = now() - interval '1 day' WHERE user_id = $(d $A);"
run "reminder skips sent_at 8 days ago"                                      "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE onboarding_emails SET sent_at = now() - interval '8 days' WHERE user_id = $(d $A);"
run "reminder skips a welcome that was never sent"                           "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE onboarding_emails SET sent_at = NULL, skipped_reason = 'club' WHERE user_id = $(d $A);"
run "reminder waits on the switch"                                           "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 $OFF"
run "reminder skips a club member"                                           "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 $CLUB"
run "reminder skips a phone-app user"                                        "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 $(device mobile)"
run "reminder skips a skipped-then-resent account"                           "ALLOWED rows=0"  "$SVC SELECT send_onboarding_reminders() AS n" "$SENT3 UPDATE onboarding_emails SET sent_at = NULL, skipped_reason = 'club' WHERE user_id = $(d $A); SELECT set_config('request.jwt.claims', '{\"sub\":\"$A\",\"role\":\"authenticated\"}', true); SET LOCAL ROLE authenticated; SELECT resend_welcome_email(); RESET ROLE; UPDATE onboarding_emails SET sent_at = now() - interval '3 days' WHERE user_id = $(d $A);"

echo
echo "## Resend"
run "resend: sent"                                                           "ALLOWED rows=1"  "SELECT (resend_welcome_email() = 'sent')::int AS n"
run "resend: one request with template welcome"                              "ALLOWED rows=1"  "SELECT resend_welcome_email(); $SVC $(reqs welcome)"
run "resend: again at once is too soon"                                      "ALLOWED rows=1"  "SELECT resend_welcome_email(); SELECT (resend_welcome_email() = 'too_soon')::int AS n"
run "resend: too soon sends nothing more"                                    "ALLOWED rows=1"  "SELECT resend_welcome_email(); SELECT resend_welcome_email(); $SVC $(reqs welcome)"
run "resend: 11 minutes later works again"                                   "ALLOWED rows=1"  "SELECT (resend_welcome_email() = 'sent')::int AS n" "UPDATE onboarding_emails SET last_resent_at = now() - interval '11 minutes' WHERE user_id = $(d $A);"
run "resend: switch off is disabled"                                         "ALLOWED rows=1"  "SELECT (resend_welcome_email() = 'disabled')::int AS n" "$OFF"
run "resend: marks a queued welcome sent, so the cron won't send it too"     "ALLOWED rows=1"  "SELECT resend_welcome_email(); $SVC SELECT send_queued_welcomes(); $(reqs welcome)" "$DUE"
run "resend: never moves an earlier sent_at"                                 "ALLOWED rows=1"  "SELECT resend_welcome_email(); $SVC $(row welcome "sent_at < now() - interval '2 days' AND last_resent_at = now()")" "$SENT3"
run "resend: works with no queued row"                                       "ALLOWED rows=1"  "SELECT resend_welcome_email(); $SVC $(row welcome "sent_at IS NOT NULL")" "DELETE FROM onboarding_emails WHERE user_id = $(d $A);"
run "resend: ignores the skip rules"                                         "ALLOWED rows=1"  "SELECT (resend_welcome_email() = 'sent')::int AS n" "$CLUB $INVITE $(device mobile)"
ROLE=anon run "anon can't resend"                                            "DENIED"  "SELECT resend_welcome_email()"

echo
echo "## Who may call what"
ROLE=anon run "anon can't send welcomes"                                     "DENIED"  "SELECT send_queued_welcomes()"
run "authenticated can't send welcomes"                                      "DENIED"  "SELECT send_queued_welcomes()"
ROLE=anon run "anon can't send reminders"                                    "DENIED"  "SELECT send_onboarding_reminders()"
run "authenticated can't send reminders"                                     "DENIED"  "SELECT send_onboarding_reminders()"
ROLE=anon run "anon can't call the skip helper"                              "DENIED"  "SELECT _welcome_skip_reason($(d $A)::uuid)"
run "authenticated can't call the skip helper"                               "DENIED"  "SELECT _welcome_skip_reason($(d $A)::uuid)"
run "authenticated can't call the data helper"                               "DENIED"  "SELECT _onboarding_email_data($(d $A)::uuid, 'welcome')"
run "authenticated can't call the switch helper"                             "DENIED"  "SELECT _onboarding_enabled()"
run "authenticated reads no queue rows, not even their own"                  "ALLOWED rows=0"  "SELECT count(*) AS n FROM onboarding_emails"

echo
if [[ $FAILED -ne 0 ]]; then echo "Some probes FAILED"; exit 1; fi
echo "All probes passed"
