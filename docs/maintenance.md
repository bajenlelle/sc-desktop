# Maintenance & bug pipeline

How a bug goes from happening to fixed, and what runs automatically along
the way. Set up 2026-08 — see `.github/workflows/claude-*.yml`, the
`report-issue` edge function, and Sentry org `scoutable` (EU).

## The two inbound flows

**Crash in production**

1. Sentry captures it (all three apps report; releases and environments are
   tagged — `scoutable-web`, `scoutable-desktop`, `scoutable-mobile`).
2. A Sentry alert rule files a GitHub issue labeled `sentry` + `app:*`
   (configured per-project in Sentry → Alerts).
3. `claude-triage.yml` runs on the new issue: dedupes, labels severity,
   posts a diagnosis comment.
4. You read the diagnosis. If the proposed fix looks safe, apply the
   **`claude-fix`** label (or comment `@claude fix this`) — the agent opens
   a PR against `main`.
5. `check.yml` gates the PR (typechecks ×4, shared tests, clippy, lint).
   You review and merge. Nothing auto-merges.
6. Ship: desktop → `/release` (tag → notarized build → auto-updater);
   web → merge to main deploys via Vercel; mobile → `eas update` (OTA,
   Phase E) or a store build for native changes.
7. Merging the fix and resolving syncs back to Sentry via the GitHub
   integration.

**User report ("Report a problem")**

1. Desktop (Settings), web (avatar menu), and mobile (Profile) all have a
   report dialog. Version, OS, route, and the last Sentry event id attach
   automatically; screenshots go to the private `feedback-screenshots`
   bucket.
2. The `report-issue` edge function stores it in `feedback_reports` and
   files a GitHub issue labeled `user-report` + `app:*` (needs the
   `GITHUB_ISSUES_TOKEN` function secret). The DB row is the source of
   truth — GitHub being down never loses a report.
3. Same triage → `claude-fix` → PR → review path as above.
4. Track/resolve reports in **/admin/feedback** (status: open → triaged →
   resolved).

## Label taxonomy

`bug` / `feature` · `user-report` / `sentry` (source) · `app:desktop|web|mobile`
· `severity:critical|high|normal|low` · `triaged` / `duplicate` / `needs-info`
· **`claude-fix`** = maintainer-approved: agent may open a fix PR.

## Security posture

- Issue text is untrusted. The triage workflow is read-mostly (no
  `contents: write`, tool allowlist without push/exfil). The fix workflow
  only fires on a maintainer-applied label or an owner/member/collaborator
  `@claude` mention, and carries no Supabase/Stripe/Apple secrets.
- Agent PRs never auto-merge; `check.yml` must pass and you must review.

## Weekly sweep (~30 min)

1. **Sentry**: new issues per project — resolve, ignore noise, extend
   `ignoreErrors` if a noisy class keeps recurring (protects the 5k/mo
   free quota).
2. **GitHub**: `triaged` issues — apply `claude-fix` to the safe ones,
   close stale `needs-info`.
3. **/admin/feedback**: reconcile statuses; a resolved issue should mean a
   resolved report.
4. **Actions usage** (Settings → Billing): private-repo minutes, macOS
   bills 10× — a desktop release costs ~350–500 billed minutes.
5. Monthly: `npm audit` pass.

## Secrets map

| Secret | Where | Purpose |
|---|---|---|
| `SENTRY_AUTH_TOKEN` (org token) | GitHub Actions, Vercel, EAS | sourcemap upload |
| `SENTRY_API_TOKEN` (read scopes) | local `.env.local` | reading issues via API |
| `GITHUB_ISSUES_TOKEN` (fine-grained PAT, Issues r/w) | Supabase function secrets | report-issue files issues |
| `GENIUS_API_KEY` (20k calls/month, SBF scope) | Supabase function secrets | genius proxies + caches match data |
| `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) | GitHub Actions | triage + fix agents |
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` (API token scoped to object r/w on the media bucket) | Supabase function secrets | presign-upload mints upload URLs; clients hold no R2 credentials |
| `R2_*` (separate token: object list + delete) | Vercel | delete-account GDPR sweep of `clips/` + `highlights/` prefixes |
| Sentry DSNs | hardcoded in each app | public identifiers, not secrets |
