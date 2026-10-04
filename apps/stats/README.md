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

### Toolchain

Expo SDK 57 requires **Xcode 26.4 or newer** (Swift 6.3). Older Xcode 26.x fails while
compiling `expo-modules-jsi` from source (`'weak' must be a mutable variable` and
`SWIFT_RETURNS_RETAINED ... not a SWIFT_SHARED_REFERENCE type`). Upgrade Xcode; EAS
builds are unaffected. Stopgap for a local dev-client build on Xcode 26.0–26.3, re-run
after every `npm install` (it edits `node_modules` only):

```bash
cd ../..   # repo root
grep -rl 'weak let runtime' node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI \
  | xargs perl -pi -e 's/^(\s*)((?:private|internal|public) )?weak let runtime/$1$2nonisolated(unsafe) weak var runtime/'
perl -pi -e 's/^(\s*)SWIFT_RETURNS_RETAINED RuntimeScheduler\(/$1RuntimeScheduler(/' \
  node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h
```

An iPhone running a newer iOS than that Xcode supports (no Developer Disk Image) cannot
be targeted by `expo run:ios --device` or `devicectl`. Build for a generic device and
install over USB instead (Wi‑Fi pairing is not enough; answer the keychain prompt for the
Apple Development key with "Always allow"):

```bash
xcodebuild -workspace ios/ScoutableStats.xcworkspace -scheme ScoutableStats \
  -configuration Debug -destination 'generic/platform=iOS' -allowProvisioningUpdates build
brew install ios-deploy   # once
ios-deploy --bundle ~/Library/Developer/Xcode/DerivedData/ScoutableStats-*/Build/Products/Debug-iphoneos/ScoutableStats.app
```

Then open the app on the phone and point it at the Metro server (`npx expo start --dev-client`).

## One-time setup before the first TestFlight build

1. `eas init` in this folder (new EAS project; `extra.eas.projectId` + `updates.url` land in app.json).
2. Supabase Auth → URL configuration: add `scoutable-stats://auth/callback` to the redirect allowlist.
3. Supabase Auth → Apple provider: add `se.scoutable.stats` to Client IDs (native Sign in with Apple).
4. Sentry: create project `scoutable-stats`, put its DSN in the EAS profile as `EXPO_PUBLIC_SENTRY_DSN`
   (no DSN is hardcoded here yet).
5. App Store Connect: new app, bundle id `se.scoutable.stats`; TestFlight external group for the pilot.

## Not yet built (see plan, phase 1 → 2)

Genius (national league) schedules in the game picker, the post-game re-process pass,
audio upload, Android.
