# Scoutable Stats (`apps/stats`)

Phone app for parents and players in the lower (Profixio) leagues: keep a game's
statistics live by voice ("tvåa nio", "retur elva", "ångra") or by tap, then publish
them so the game shows **Stats available** in the desktop app's import page, where the
events are synced with the video like any league feed.

Design, data model and phases: `~/.claude/plans/check-the-recent-github-hashed-key.md`
(brainstorm of 2026-10-04). Shared logic lives in `packages/shared`:
`lib/stat-grammar.ts` (Swedish grammar), `lib/stat-session.ts` (reducer, box score,
export), `lib/stat-sessions-db.ts` (Supabase). Schema: `supabase/migrations/20261004200000_stat_sessions.sql`.

## Run

```bash
cp apps/mobile/.env apps/stats/.env   # same Supabase project + PostHog key
cd apps/stats && npx expo run:ios     # dev client; the speech module is native
```

Voice needs a real iPhone (iOS 17+, Swedish dictation downloaded); the simulator has
no on-device recognition. The tap pad works everywhere. `MockRecognizer`
(`src/features/stat-keeper/recognizer/mock.ts`) drives the live screen without a mic.

## One-time setup before the first TestFlight build

1. `eas init` in this folder (new EAS project; `extra.eas.projectId` + `updates.url` land in app.json).
2. Supabase Auth → URL configuration: add `scoutable-stats://auth/callback` to the redirect allowlist.
3. Supabase Auth → Apple provider: add `se.scoutable.stats` to Client IDs (native Sign in with Apple).
4. Sentry: create project `scoutable-stats`, put its DSN in the EAS profile as `EXPO_PUBLIC_SENTRY_DSN`
   (no DSN is hardcoded here yet).
5. App Store Connect: new app, bundle id `se.scoutable.stats`; TestFlight external group for the pilot.

## Not yet built (see plan, phase 1 → 2)

Linking a game to the Profixio schedule from the phone (today games are unlinked and
appear under "My recorded games" on the desktop), the post-game re-process pass,
audio upload, Android.
