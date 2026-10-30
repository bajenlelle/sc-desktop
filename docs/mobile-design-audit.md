# Mobile design audit: the desktop and web feel on the phone (v2)

Date: 2026-10-30. Branch: `design/mobile-v2`, cut from `main` (1.6.0, `553cc0e`) with `design/apple-redesign-mobile` (v1) merged in; local, not merged.
Tested on: the iOS 26 Simulator (iPhone 17) running the EAS development build, and the Pixel 8 emulator (Android 17) running a local debug build, both against production in read-only dev mode (section 5). Screenshots are kept outside the repository (they show real club, player and customer names). The approved mockups are a Design canvas (fake names) linked from `design-audit/mobile-v2/decisions.md`, also outside the repository.

## 1. Summary

**Before (`main`):** hand-built chrome, Barlow Condensed titles, twelve colour tokens, Unicode glyphs as icons, a portrait-only player, RN `<Modal>` sheets, never built for Android.

**v1 (2026-10-09/10, `design/apple-redesign-mobile`):** the web's phone layout inside native chrome per platform (NativeTabs, large titles, an iOS header search bar, Material on Android), SF Symbols and Material Symbols, the web's derived colours and text styles. The native shell worked; the screens did not. Next to desktop and web the founder found it unfinished and cluttered: everything a bordered card, feed rows with up to eight controls, filters stacked above the content, secondary text nearly the size of body text, primary tints at five strengths, nine Tailwind colour families on the clip list.

**v2 (this branch):** the desktop's calm, the way the Claude and Notion apps read: the system font on the desktop/web scale, one accent used sparingly, content as plain rows on the page, settings as grouped lists, filters and sort behind one button, and the app's own chrome, the same on iOS and Android.

## 2. Decisions

The founder's (2026-10-29/30):

- **Type:** Inter (2026-10-30, chosen over the system font after a side-by-side on the mockup canvas: the Notion feel), on the web's touch scale with Inter's own size-specific tracking. The large title, title 2 and the headline are semibold (600). Inter is free (SIL Open Font License), bundled from `@expo-google-fonts/inter` and loaded by the root layout; each weight is its own font file, so `Text` picks the file from the weight (`src/lib/fonts.ts`). Claude's own faces (Anthropic Sans and Serif) can't be licensed.
- **Shared by me as cards** (2026-10-30, after the founder found the plain rows "just a bunch of words"): one card per playlist on the grouped floor, read top to bottom as where it went (team, footnote), what it is (semibold name, then "Shared 1 Sept · 7 clips") and how it's going (the web's and desktop's watch bar with "1 of 7 finished · 2 watching"); the opened card lists the recipients inside it. The stat line keeps one sentence but sets each figure semibold in the text colour. Pattern sources: Google Classroom's per-assignment turned-in counts, Material's three-line item (overline, headline, supporting text), NN/g on cards for grouped, tappable items.
- **Where a playlist comes from:** once a player's feed mixes teams (or a team and personal shares), each row names its team, or "Just for you", in a footnote line above the name (`feedSourceLabel`, `feedHasSeveralSources`, tested).
- **Chrome:** the app's own, identical on both platforms: a 49 pt tab bar with a red count of new playlists, and a title bar that starts large and hands over to a centred small title as the content scrolls under it. No NativeTabs, no native large titles, no header search bar.
- **Density:** content first. Filters and sort behind one title-bar button that opens a sheet; stats as one sentence; the hero as one row; no filled "New" pills.
- **Android bars** are solid (Material's idiom; expo-blur there re-renders a blur target every scroll frame). iOS blurs, except under Reduce Transparency.

Made while building (each in the plan's ledger with its cost): icons are lucide (`lucide-react-native` at the web's version, JS only), the same glyphs and 1.75 stroke as desktop and web; menus, the filter sheets and the theme picker are the app's own `Sheet` rather than platform menus or native sheets (Feedback and Delete account keep native form sheets for the keyboard); settings screens sit on a grouped floor (`canvas`, the `muted` tone where a light theme's cards equal its page) while content screens stay on the page colour; hairlines are a device pixel; the Up next playlist isn't repeated in its section.

## 3. What v2 does

One commit per milestone.

| Milestone | What changed | Where |
|---|---|---|
| M1 Tokens, type, icons | `eventHue`, `canvas`, `eventDot`, `themeVarMap` (tested); the tracked type scale; radius aliases (`control` 6, `inner` 4, `window` 10, `sheet` 14); a bare `border` is a separator hairline; lucide behind the same icon map; `darkVarsStyle` for dark-only surfaces | `packages/shared/lib/{events,theme-derived}.ts`, `tailwind.config.js`, `src/lib/theme-context.tsx`, `src/components/ui/Icon.tsx` |
| M2 Shell, primitives | `TabBar` on expo-router's `Tabs`; `Screen` (title bar, large title hand-off, material once content passes under, pull to refresh); `Material`; `BackButton`; `SheetHost`/`Sheet`/`MenuSheet` (drag to dismiss, Android back); `ToastHost`; `Row`, `PlainList`, `SectionHeader`, `Dot`, `NoticeRow`, `StatLine`, `FilterButton` | `src/components/shell/*`, `src/components/ui/{Sheet,Toast,Row,FilterButton}.tsx` |
| M3 Feed | Up next row, New/In progress/Watched as plain rows (dot, ring), `FeedFilterSheet` (Show with counts, Team, From), active-filter line with Clear, search from eight playlists; notices as rows (`feedSections`, `activeFeedFilterCount` tested) | `src/components/{PlaylistFeed,FeedFilterSheet}.tsx`, `src/app/(app)/(tabs)/playlists/index.tsx` |
| M4 Shared by me | Stat line; one control per row (it opens); unfinished recipients with Remind as text, finished folded into one line; Remind all and Watch as a player at the foot; status, team and sort in the filter sheet; bulk results as toasts | `src/components/SharedByMeDashboard.tsx` |
| M5 Watch | The app's bar; one floating glass control bar in every layout (wide adds replay and stop); clip rows led by the player with a 6 pt hue dot, no strip or pill | `src/app/(app)/playlists/[id].tsx`, `src/components/player/*`, `src/components/WatchClipRow.tsx` |
| M6 Profile | Team, Account, Devices, Help and a last group to sign out or delete; every action a disclosure row; the theme sheet | `src/app/(app)/(tabs)/profile/index.tsx`, `src/components/{AppearanceSection,DevicesSection,TeamSection}.tsx` |
| M7 Signed out, gates, sheets | Title 2 headings, `AuthStatus`, the team picker on the app's bar with search in the list, calmer Feedback/Delete sheets, My highlights as plain rows, device gate and error screen on the status-screen metrics | `src/components/auth/AuthFrame.tsx`, `src/app/(auth)/*`, `src/app/(app)/{team,onboarding,no-org,feedback,delete-account}.tsx`, `src/components/DeviceGateScreen.tsx` |
| M8 Android, accessibility, docs | Large-text fixes (search field and coach rows grow), unused primitives removed (Badge, ProgressBar, StatCells, Callout, FormRow, LeagueChip), this document | |

## 4. Behaviour changes

All presentation; every `trackEvent` name and count matches `main` (checked at each milestone), and no route was added, so `page_viewed` is unchanged.

- Filters and sort moved from segmented controls and pop-ups into one sheet per list; the filter button turns primary while any is on, and a footnote line names them with Clear.
- The feed's hero is an Up next row (Resume or Watch as text); that playlist isn't repeated in its section. "n left" became "x of y watched" in the description.
- Search is a field under the title on both platforms, shown from eight playlists (the coach's dashboard always).
- Shared by me: the three stat cells became a sentence whose last part filters; rows open into their recipients; per-player and per-playlist reminders and "Watch as a player" live in the opened row; bulk reminder results are toasts (failures still alert).
- The player's upright layout lost its three big centre buttons and corner buttons for the same glass bar the wide layout had; the clip list lost its progress bar.
- Profile: inline Change…/Delete… buttons became rows; the theme swatches moved into a sheet; Sign out and Delete account form the last group.
- Tab bar badge: the red count of new playlists stays (founder's call), drawn by the app.

## 5. Verification

- **Each milestone:** `npm run typecheck` (mobile, shared; web and desktop when shared changed), the shared tests (1352), the analytics comparison with `main`, the outbound-link grep, and runtime checks on both devices.
- **Read-only mode:** Metro ran with `EXPO_PUBLIC_READ_ONLY=1` and empty PostHog and Sentry keys; every write was refused and logged (watches, reminders, device touches, theme sync).
- **Runtime, both platforms:** the tab bar and its badge; the title bar's hand-off and material while scrolling, and after switching tabs; menu and filter sheets opened, applied, reset, dragged closed (iOS) and closed with Android back; the feed's rows and filters; the dashboard's rows, opened recipients and filter sheet; the watch view, playback with the glass bar and timeline, full screen in landscape and Done back to upright; Profile and the theme sheet (Courtside applied and set back); the team picker; an invalid invite's status screen; the feedback sheet over the keyboard; large text (iOS accessibility-medium, Android font scale 1.3).
- **Grep gates:** no `expo-symbols`, `@expo/ui`, `expo-glass-effect` or `@expo/vector-icons` import; no radius outside the policy (the player bar's 12 pt is the one exception); no retired component.

Not verified: the signed-out screens, onboarding, no-org, the device gate and the error screen at runtime (signing out would end the test sessions; typecheck and reading only); Reduce Motion and Reduce Transparency at runtime (springs use `ReduceMotion.System`; `Material` and `PlayerMaterial` go solid); VoiceOver and TalkBack passes; a physical iPhone or Android phone; iPad; push end to end; a real join, reminder, feedback report or account deletion; Sign in with Apple.

## 6. Known gaps and next steps

- **Store build.** `expo-symbols`, `@expo/ui`, `expo-glass-effect` and `@expo/vector-icons` are still in `package.json` so the installed dev clients keep matching (the native fingerprint is unchanged on this branch). Remove them (keep `expo-font`: it loads Inter), set the `expo-notifications` colour to the primary, align lucide across the three apps, then build. Publish `main`'s pending OTA before merging: after the merge the runtime fingerprint changes.
- **iOS title bar edge:** RN has no mask-image, so the blur ends hard and a 10 pt gradient of the page colour stands in for the web's fade.
- **iOS refresh spinner** shows through the clear bar while pulling and sits partly under the status bar text.
- **Text size changed while the app is open** can leave text clipped until relaunch (RN keeps the old measurements).
- **Maestro flows** live in `design-audit/mobile/flows` (outside the repository); `m6-profile.yaml` now taps "Send feedback" and "Delete account". Maestro takes whole-number percentages only.

### What a Google Play release would take

The app builds and runs on Android 17, and edge-to-edge, the keyboard, back handling, sheets, menus and full screen were checked on the emulator. To ship it:

1. **A Play Console app** for `se.scoutable.app`, with an upload key managed by EAS (`eas credentials -p android`) and an `android` section in `eas.json`'s production profile (app bundle).
2. **Push:** `google-services.json` is already in the app; the FCM server key or v1 credentials go into EAS for `expo-notifications`.
3. **App links:** `assetlinks.json` on app.scoutable.se for invite and playlist links (iOS uses universal links for the same).
4. **Sign in with Apple** runs through the browser on Android (the Apple service ID's return URL must allow the app's redirect); Google sign-in works as on iOS.
5. **Store listing:** screenshots, the Data safety form (account data, watch history, crash reports, analytics), a content rating, the privacy policy URL, target API level as Play requires.
6. **Policy:** keep the same club-only, no-purchase, no-outbound-link stance as on iOS; Play's payments policy treats links to web purchases much like App Review does.
7. **Testing on real devices** through an internal testing track before production.
