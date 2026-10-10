# Web design audit: the desktop redesign brought to the web app

Date: 2026-10-09. Branch: `design/apple-redesign-web`, cut from `main`; local only, not merged.
Audited build: `main` as deployed to app.scoutable.se, walked through at 1280 × 800 with a mouse and at 390 × 844 as a touch screen, in light, dark and Aubergine. Screenshots are kept outside the repository (they show real club, player and customer names).

This is the web counterpart of [desktop-design-audit.md](desktop-design-audit.md) on the `design/apple-redesign` branch. The lens is the same (Apple's *Designing Fluid Interfaces*, *The Details of UI Typography* and *Principles of Great Design*, translated for the web), and the landing site's DESIGN.md is set aside for the same reasons (desktop audit, section 4). The web app has a different job: players watch on phones, coaches check sharing and manage the club, and platform admins run licences. So the redesign has two shells, one per input.

## 1. Summary

What `main` looked like before the redesign:

1. **A web page's chrome.** A top navigation bar with a hamburger sheet on phones, a space header under it, a floating Feedback button over the content, and a sun/moon toggle in the bar with no "System" option.
2. **Three typefaces.** DM Sans for text and Barlow Condensed for every `h1`–`h3`, both loaded as packages, plus uppercase tracked labels.
3. **Nothing responds on press, and nothing springs.** Feedback comes on hover and after release. Transitions are `tw-animate-css` tweens.
4. **Colours defined in `packages/shared` were never generated.** Tailwind didn't scan `packages/shared/lib`, so the event colours and plan-badge colours used there produced no CSS on web.
5. **The player page was 1,320 lines.** The data loading, the feed, the playlist list beside the player and the video were all in one file. Its fallback to the full-match video (`currentClipR2 ?? videoUrl`) almost never found a file on web, so most clips without an upload showed "No video available". A page-wide Space listener competed with the controls. The once-per-clip watch record was guarded by a flag set inside a state update, which can misfire when updates batch. Clips were matched by event id alone, which picks the wrong clip in a playlist that spans several games.
6. **Toasts stayed light in dark mode** (Sonner's `richColors` palette).
7. **Forms and admin were stock web.** Native `<select>`s and tables, `window.confirm` for refills, a failed share that said nothing, "Remove all" for unsharing, title-case buttons.
8. **An error anywhere took the navigation with it.** The only error boundary was the root one, which replaces the signed-in layout. There was no not-found page beyond Next's default.
9. **Accessibility settings barely registered.** Reduced motion was honoured only by the My highlights video (a still poster instead of the loop), and there was nothing for reduced transparency or increased contrast to act on.

## 2. Decisions

- **Type:** the system font with one set of text styles at two scales. With a mouse or trackpad (`pointer: fine`) it uses macOS sizes (body 13, large title 26). On touch (`pointer: coarse`) it uses iOS sizes (body 17, large title 34). Inputs are at least 16 px on touch, so Safari doesn't zoom in on focus.
- **Shell by width:** desktop's sidebar from 1024 px. Below that, an iOS navigation bar with a large title and a bottom tab bar: players get My playlists, My highlights and Profile; staff get Shared playlists, Club and Profile; platform admins also get Admin. The page itself scrolls (sticky toolbars), so Safari's bars collapse and tap-to-top keeps working.
- **Appearance** follows the system, with System / Light / Dark in Profile. The eight colour themes and their sync are unchanged.
- **Materials:** translucency only for floating chrome (toolbars once content is under them, the tab bar, menus). Hover and press use neutral fills, selection uses the accent, and amber means warning only.

## 3. What the redesign does

One commit per milestone (W1–W9), plus fixes.

| Milestone | What changed | Where |
|---|---|---|
| W1 Foundations | Desktop's tokens, text styles at two scales, materials, radii, shadows and motion; `@source` for `packages/shared/lib` (fixes finding 4); a toaster that follows the theme and clears the tab bar; viewport-fit cover with theme colours | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/providers.tsx`, `src/lib/{utils,motion,format-date}.ts` |
| W2 Primitives | Desktop's controls (button, badge, dialog, menus, grouped lists, pop-up button, segmented control, search field, stepper, switch, status screen, empty state, auth frame). Web additions: 44 pt targets on touch, dialogs as bottom sheets on phones, menus that render inside full screen | `src/components/ui/*`, `src/lib/{pressable,key-scope}.ts` |
| W3 Shell | Sidebar (space switcher, destinations, desktop-app card, account menu) and the tab bar; destinations per user from one tested function | `src/components/shell/*`, `packages/shared/lib/app-nav.ts` + tests |
| W4 Player | The page's data logic moved unchanged into a hook. A new player: imperative `src` and `play()` inside the tap (iOS autoplay rules), idle-hiding controls, a 1:1 scrubber, the keys under one key scope, native full screen where it exists and a full-window layer on iPhone. The watch record is a ref-held set keyed by game and event (fixes the two bugs in finding 5) | `src/components/player/*`, `src/components/playlist/*`, `packages/shared/lib/watch-queue.ts` + tests |
| W5 Shared by me | Grouped rows that spring open into recipients; the share dialog gets a callout for clips not uploaded yet, Cancel, a spinner and an error toast | `src/components/playlist/SharedByMe.tsx`, `share-recipients.tsx` |
| W6 Club | Teams/Members in the toolbar, the role filter as a pop-up, confirmation before deleting a team; the invite and team dialogs replayed from desktop | `src/app/(app)/organization/page.tsx`, the club components |
| W7 Profile | Grouped lists, Appearance with System / Light / Dark and the swatches, devices, marketing switch, delete account, feedback as a text area | `src/app/(app)/profile/page.tsx` |
| W8 Signed out | Sign-in and signup in the auth frame with a cross-fade; join, unsubscribe and the public highlight page on the same frame (native video controls kept on `/h`); onboarding, Get started and My highlights | `src/app/(auth)/*`, `src/app/join`, `src/app/h`, `src/lib/brand.ts` |
| W9 Admin, errors, accessibility | Admin's sections in a segmented control; grouped rows instead of tables; a plan menu that shows a hand-set lock; error pages on the status screen; the accessibility settings fixed and checked | `src/app/(app)/admin/**`, `src/components/admin/*`, `src/app/error.tsx`, `src/app/(app)/error.tsx`, `src/app/not-found.tsx` |

## 4. Behaviour changes

Approved with the plan:

- The playlist list beside the player on wide screens is gone; the feed and a back button replace it, as on desktop.
- The full-match video fallback is gone; the player waits with a Play button.
- Feedback moved into the account menu and Profile; the theme toggle moved to Appearance.
- Navigation says "Club" instead of "Organization" (legal and admin copy keeps "organization").
- "Remove all" in sharing became "Stop sharing".
- Playback speed is remembered between clips and visits.
- Analytics keep `main`'s semantics: every `trackEvent` call matches `main` in name and count, checked at each milestone.

Added while building, all in the same spirit:

- **Admin** has four peer sections. Import grants and free refills moved from the bottom of the organizations list to their own Imports section. Feedback status is chosen from a pop-up instead of clicking to cycle. Removing a member from an organization asks first, as on the Club page. A free refill asks in a dialog instead of `window.confirm`.
- **Join a team** (`/onboarding`) hides the tab bar. It's a focused task, and for an account with no space it's the only page there is, since `proxy.ts` sends every route there. Reached from Get started, it has a back button, and its Sign out shows only when there is no space.
- **Errors inside the signed-in app** now keep the sidebar and tab bar (new `(app)/error.tsx`); unknown URLs get a not-found page.

After review (2026-10-10):

- **Players can't seek ahead.** A clip counts as watched near its end, so a player who dragged there skipped it. Players get the times around a read-only progress line, → and Shift+→ do nothing, the media session (lock screen, Control Center) can only go back, and the video has no picture in picture or context menu. ←, J, Replay, previous/next and speed still work. The playlist's owner and its club's coaches and admins keep the scrubber (`canScrubPlaylist` in `packages/shared/lib/watch-queue.ts`).
- **At phone width the playing row says what's playing.** The "now playing" block under the player repeated the row and changed height between clips and text cards; below the side-by-side width it's hidden and rows show the coach's note in full. The wide layout is unchanged.
- **Signing out loads `/login` fresh** (`src/lib/sign-out.ts`). It used to re-render the signed-in page without a user first, which crashed on iPhones that had wrapped the email in "Sign out of …" (Sentry SCOUTABLE-WEB-C, "Something went wrong" until a refresh). `format-detection` is now off, so Safari doesn't wrap emails, numbers or dates in React's text.
- **Clear filters** on Shared by me also clears the search.

## 5. Verification

- **Each milestone:** `tsc`, `npm run lint` (0 errors; warnings down from `main`'s 45 to 25), the shared tests, the analytics comparison and screenshots. `next build` passed once mid-way and again on the finished branch.
- **Screenshots** were taken through Chrome's DevTools protocol against the local dev server, with every Supabase write and analytics/Sentry request blocked. Signed-out pages used a fresh browser context.
- **iPhone (iOS 26 Simulator, Safari):** a tap plays with sound, the queue advances, a watch is recorded once, autoplay without a tap falls back to a paused player, and the full-window layer, Done and the sticky player all work.
- **Accessibility settings:** reduced transparency and increased contrast, each emulated and compared with the default (this found the light-mode bug in section 6). Reduced motion was on for every capture; the app's `MotionConfig` and the segmented control (the one animated control on a signed-out page) honour it.
- **Server rendering:** a production build (`next start`) rendered 10 signed-in pages in parallel without errors. See the dev-server note below.

Not verified: Android, iPad, Safari on macOS, Windows browsers; a real share, invite, join, refill or plan change (nothing was submitted from the branch); the player-only shell with a real player account (covered by the `app-nav` tests and a temporary forced-role preview).

## 6. Known gaps and next steps

- **Dev server only:** under concurrent requests, Turbopack's dev server sometimes renders `ThemeSync` against a second copy of the colour-theme context. It throws "useColorTheme must be used within ColorThemeProvider" and falls back to client rendering. The page still works, but each failure reaches Sentry as a `development` event. The production build doesn't do this (section 5).
- **Fixed here, still open on the desktop branch:** the reduced-transparency and increased-contrast overrides were scoped to `html`, which `:root` (where the variables are set) outranks. In light mode they did nothing. `globals.css` now uses `:root`. The desktop branch's `index.css` has the same selectors: increased contrast is dead in light mode there, and reduced transparency on Windows.
- **Fixed 2026-10-10:** Sign out on `/onboarding` used `signOut()`'s default global scope, which signed the account out on every device. Every sign-out in the app is now local.
- The narrow-screen toolbar's primary actions are filled buttons; iOS would use a plain tinted glyph.
- With classic (non-overlay) scrollbars, the toolbar's centred control shifts slightly between pages that scroll and pages that don't.
- `global-error.tsx` still shows Next's default page, and `/view/[playlistId]` remains a bare redirect.

**Merging:** `player-keys.ts`, `motion-math.ts` and `formatClipTime` came from the desktop branch as exact copies, so either branch can merge first. Run `npm install` after merging to settle the lockfile; web gained `framer-motion` and lost the DM Sans, Barlow Condensed and `tw-animate-css` packages.
