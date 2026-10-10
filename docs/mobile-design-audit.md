# Mobile design audit: the web redesign brought to the mobile app

Date: 2026-10-10. Branch: `design/apple-redesign-mobile`, cut from `main` (`df152a7`); local only, not merged.
Tested on: the iOS 26 Simulator (iPhone 17, iPhone 17 Pro, iPhone 16e) running an EAS development build, and the Pixel 8 emulator (Android 17) running a local debug build. Both ran against production in a read-only dev mode (section 5). Screenshots are kept outside the repository (they show real club, player and customer names).

This is the mobile counterpart of [web-design-audit.md](web-design-audit.md). The brief was for the app to look like the web app at phone width, and to work on Android too. The shell is native to each platform: iOS gets large titles and the system tab bar (Liquid Glass on iOS 26), and Android gets Material's top app bar and navigation bar. Everything inside the screens follows the web's phone layout.

## 1. Summary

What `main` looked like before:

1. **Hand-built chrome.** Every navigator hid its header and each screen drew its own title row. The tab bar was the JavaScript one, with a "Feedback" pill in the feed header and on the watch screen.
2. **Barlow Condensed for every title**, DM Sans loaded but unused, no text component, and about a dozen uppercase tracked labels.
3. **Twelve colour tokens and nothing else.** There were no fill, separator, success or warning colours, so screens used raw amber/emerald classes and hex values.
4. **Unicode glyphs and emoji as icons** (▶ ⏮ ✓ 💬), which render differently on every device, plus Ionicons in a few places.
5. **A portrait-only player** with glyph buttons under the video. It had no timeline or full screen, the speed reset on every visit, and a clip that wouldn't load was skipped silently. The watched guard lived in a ref mirrored from state, the race the web fixed with `recordOnce`.
6. **RN `<Modal>` bottom sheets** for feedback, account deletion, speed and selects. Their insets are wrong under Android's edge-to-edge.
7. **Never built for Android.**

## 2. Decisions

- **Ship path:** a new store build. Native modules were added (`expo-blur`, `expo-haptics`, `expo-screen-orientation`, `react-native-svg`), and `expo-symbols`, `expo-glass-effect` and `@expo/ui` became direct dependencies. All native changes went in at the start, so one EAS build covered the whole branch.
- **Chrome per platform:** `NativeTabs` (`expo-router/unstable-native-tabs`) with a native stack per tab. Large titles and header search bars on iOS; Material on Android, where search is the web's field at the top of the content (the toolbar would hide it behind an icon). Watch, team, sheets and gates sit in the `(app)` stack above the tabs.
- **Type:** the system font (SF Pro / Roboto) with the web's touch text styles as a `Text` component (large title 34/41 … footnote 13/18), tabular figures for counts and clocks, and Dynamic Type left on.
- **Colour:** the theme tokens plus colours derived from them in `packages/shared/lib/theme-derived.ts` (tested): fills 1–4, separators, popover, success, warning, materials. They're injected through the same NativeWind `vars()`, and the eight themes and their sync are unchanged.
- **Icons:** SF Symbols on iOS and Material Symbols on Android through `expo-symbols`, from one meaning-based map. The transport glyphs (play, pause, previous, next, stop) are drawn filled on Android, because the bundled Material font is outlined only.
- **Motion and feedback:** the web's named springs in Reanimated (honouring Reduce Motion), feedback on press-in, and haptics only for selection changes and successes (reminding, joining, sending feedback).

## 3. What the redesign does

One commit per milestone.

| Milestone | What changed | Where |
|---|---|---|
| M0 Testing setup | Read-only dev mode (`EXPO_PUBLIC_READ_ONLY=1` wraps the global `fetch`; reads pass, writes are refused with a 403 and logged). Native modules and config, `development-simulator` EAS profile, root gesture handler, portrait lock with landscape allowed | `src/lib/dev-read-only.ts`, `app.json`, `eas.json`, `package.json`, `src/app/_layout.tsx` |
| M1 Foundations | Derived colours (+ tests), Tailwind colours and radii, the `Text` styles, springs, haptics, the icon map, the navigation theme; font packages removed | `packages/shared/lib/theme-derived.ts`, `src/lib/{theme-context,motion,haptics,cn}.ts*`, `tailwind.config.js` |
| M2 Shell | NativeTabs with per-tab stacks, large titles, the New badge; the player-only tab latched on the first settled profile (changing `hidden` remounts the navigator) | `src/app/(app)/(tabs)/**`, `src/components/shell/stack-options.ts` |
| M3 Primitives | Button, grouped lists, callouts, segmented control, pop-up button (`@expo/ui` `MenuView`), badge, empty and status screens, progress ring and bar, stat cells | `src/components/ui/*` |
| M4 Feed and Shared by me | One scroll view under the large title, search in the bar, pull to refresh; the Continue hero, filters, sections with progress rings; the dashboard with stat cells, recipients that open in place and Remind | `src/app/(app)/(tabs)/playlists/index.tsx`, `src/components/{PlaylistFeed,SharedByMeDashboard}.tsx` |
| M5 Player | The stage with controls that fade when idle (compact and wide layouts), a 1:1 timeline, a full-window full screen in landscape, a remembered speed menu, pausable text cards; "Now playing" with the coach's note; rows with a highlight that springs between them; the queue on the shared `WatchItem` model and `recordOnce` | `src/components/player/*`, `src/hooks/use-clip-queue.ts`, `src/app/(app)/playlists/[id].tsx`, `src/components/WatchClipRow.tsx` |
| M6 Profile | Grouped lists (Your team, Club, Account, Appearance, Devices, Help, Delete account); Send feedback and Delete account as native form sheets | `src/app/(app)/(tabs)/profile/index.tsx`, `src/app/(app)/{feedback,delete-account}.tsx` |
| M7 Signed out and gates | Sign in, sign up and reset in the web's auth frame; join, onboarding and no-org (copy unchanged); the team picker with native search; device gate, error screen, My highlights | `src/app/(auth)/*`, `src/components/auth/AuthFrame.tsx`, `src/app/(app)/{team,no-org,onboarding}.tsx`, `src/app/join/[code].tsx` |
| M8 Android, accessibility, docs | Large-text adaptations, a lighter segmented thumb in dark themes, this document | see section 5 |

## 4. Behaviour changes

Approved with the plan:

- Feedback moved to Profile ("Send feedback…"). The feed's pill and the watch screen's button are gone.
- Tab labels are sentence case: "Shared playlists" / "My playlists", "My highlights", "Profile".
- Playback speed is remembered (`scoutable_watch_speed`, as on web).
- The player gained a timeline, controls over the footage that fade when idle, and a landscape full screen where text cards and the queue keep working.
- The coach's Shared by me / Shared with me pills and the feed chips are segmented controls; the From/Team filters and the speed picker are native menus.
- Analytics: every `trackEvent` call matches `main` in name and count (checked at each milestone). `page_viewed` skips the two sheet routes, and closing a sheet doesn't count the screen underneath again.

Added while building, all following the web:

- **Play / Resume** in the player start at the first unwatched clip, as on web, rather than at clip 1.
- **A clip that won't load** shows "Can't load this clip…" over the footage instead of skipping ahead, so a dropped connection no longer runs through the whole queue. Play retries it.
- **The end of the queue** clears the active row (it used to stay highlighted).

After review (2026-10-10), on mobile and on the web at phone width:

- **Players can't drag the timeline.** A clip counts as watched near its end, so dragging there skipped it. Players get the times around a read-only progress line; the playlist's owner and its club's coaches and admins keep the scrubber (`canScrubPlaylist` in `packages/shared/lib/watch-queue.ts`). Previous/next, replay and speed are unchanged.
- **No "now playing" block under the video.** It repeated the playing row and changed height between clips and text cards, so the list jumped. The playing row says what's playing, and rows show the coach's note in full.
- **No "Remind all" on Shared by me.** Coaches remind per playlist ("Remind N") or per player, as on the web and desktop.
- **Search:** a visible field on Android (see Chrome per platform); "Clear filters" also clears the search, the native iOS field included.
- **Text cards can be paused.** While one shows, the phone layout's controls move to the bottom so the card's text isn't covered. The web's compact player covers it; worth carrying back.
- **Watches** are claimed through `recordOnce` in the store, seeded from the loaded views and started over for a different account, which closes a double-record race.
- **The team step at launch** has no back button; it's answered or skipped, as before.
- **Sign-up's role** is a segmented control with the web's hints; it still starts on "I play" and still has no social sign-in.
- **Copy** now follows the web: "Sign in to Scoutable", "Create your account", "Reset your password", "Check your inbox", the My highlights intro. The no-org screen's copy is unchanged word for word (App Review saw it).

App Store constraints (see the 3.1.3(c) notes in the code) are unchanged: no outbound links (`openBrowserAsync`/`Linking.openURL` appear nowhere), nothing on screen reads the plan tier, no upgrade or renewal call to action, clubs only (personal spaces never appear in the switcher), native Sign in with Apple on iOS.

## 5. Verification

- **Each milestone:** `npm run typecheck` (mobile and shared), the shared tests (758), the analytics comparison with `main`, the outbound-link grep, and screenshots of both platforms in light and dark.
- **Read-only mode:** Metro ran with `EXPO_PUBLIC_READ_ONLY=1` and empty PostHog and Sentry keys, so every write was refused in the app (watches, team choices, device touches, reminders) and logged. Nothing was submitted to production.
- **Player, both platforms:** play, pause, auto-advance, scrubbing (grab, jump, past the ends), speed menu and remembered speed, full screen in landscape, Done and Android back, text card pause and resume, VoiceOver labels.
- **Sheets:** native form sheets on iOS and Material bottom sheets on Android, both above the software keyboard.
- **Accessibility:** iOS text size at accessibility-large and Android font scale 1.3; Increase Contrast. Large text found the layouts that couldn't take it, and they now adapt as iOS's own do (`useLargeText()` in `src/lib/a11y.ts`): segmented controls become a pop-up menu, rows put their trailing control under the text, stat cells stack, button pairs stack, and buttons grow with their labels. Icons are decorative to screen readers (the symbol's own system label was read in front of the button's), the coach's timeline is adjustable (a player's reads as a progress bar), and the list under the full-screen player is hidden from VoiceOver. Reduce Motion is honoured through `ReduceMotion.System` in every spring; Reduce Transparency makes the player's dark glass solid.

Not verified: playback in the iOS Simulator after the 2026-10-10 review changes (the Simulator's audio queue wouldn't start on this Mac, so AVPlayer stalled at 0:00 for every clip; the same code played on Android), Clear filters emptying the native iOS search field, a physical iPhone or Android phone (blur, haptics and rotation feel), iPad, push notifications end to end, a real join, reminder, feedback report or account deletion (all refused by read-only mode), and Sign in with Apple (native SIWA doesn't run in an unsigned Simulator build).

## 6. Known gaps and next steps

- **Text size changed while the app is open** can leave text clipped until the app is relaunched: React Native keeps the old text measurements. Launching at any size lays out correctly.
- **Back to the web:** two things found here apply to the web as well. In dark themes the segmented control's thumb (the card colour) is darker than its track, so the choice reads as a hole; mobile now uses a lighter fill there. And the web's compact player covers a text card with its centre controls.
- **The header search bar** starts pinned on iOS and is released once the screen has been shown, because UIKit otherwise starts a hide-when-scrolling search bar hidden. The workaround is in the Playlists screen.
- **The iOS speed menu** follows the app's appearance (a light menu over the dark player in light mode); `MenuView` takes `colorScheme` on Android only.
- **`@expo/vector-icons`** is no longer imported by the app. It stays in `package.json` until the next store build so this branch's fingerprint doesn't move twice.
- **Merging:** the native changes need a new store build (App Review included). Publish the pending "Your team" OTA from `main` *before* merging: after the merge the runtime fingerprint changes, and `main` can no longer update the build that's in the store.

### What a Google Play release would take

The app builds and runs on Android 17, and edge-to-edge, the keyboard, back handling, sheets, menus and full screen were checked on the emulator. To ship it:

1. **A Play Console app** for `se.scoutable.app`, with an upload key managed by EAS (`eas credentials -p android`) and an `android` section in `eas.json`'s production profile (app bundle).
2. **Push:** `google-services.json` is already in the app; the FCM server key or v1 credentials go into EAS for `expo-notifications`.
3. **App links:** `assetlinks.json` on app.scoutable.se for invite and playlist links (iOS uses universal links for the same).
4. **Sign in with Apple** runs through the browser on Android (the Apple service ID's return URL must allow the app's redirect); Google sign-in works as on iOS.
5. **Store listing:** screenshots, the Data safety form (account data, watch history, crash reports, analytics), a content rating, the privacy policy URL, target API level as Play requires.
6. **Policy:** keep the same club-only, no-purchase, no-outbound-link stance as on iOS; Play's payments policy treats links to web purchases much like App Review does.
7. **Testing on real devices** through an internal testing track before production.
