# Desktop design audit: Apple's fluid-interface principles applied to Scoutable

Date: 2026-10-08. Branch: `design/apple-redesign` (cut from `main` at 0.7.0).
Audited build: Scoutable 0.7.0 (the released macOS app, identical to `main`), walked through at 1280×720 in the Courtside light theme and the default dark theme. Screenshots are kept outside the repository (they show real club and player names).

The lens is the `apple-design` skill: Apple's *Designing Fluid Interfaces*, *The Details of UI Typography*, *Designing Audio-Haptic Experiences* and *Principles of Great Design*, translated for the web. The landing site's DESIGN.md (flat, hairline-only, condensed display face, icon rail) was set aside on purpose; section 4 lists what was dropped and why.

Decisions taken before the redesign: the platform system font (SF Pro on macOS, Segoe UI on Windows); native Finder-style window chrome on macOS (traffic lights inside a translucent sidebar); follow the OS appearance by default, keeping the eight colour themes; hand-redesign the coach's daily path (shell, Home, Library, the playlists editor, Add Clips, import and tip-off), with the foundations reaching every other screen.

## 1. Summary

1. **Nothing moves like a physical object.** There are no springs; every transition is a 150 ms CSS tween. Menus cut on close, dialogs zoom from the screen centre instead of their trigger, the Share dialog jumps between three heights, the tip-off suggestion strip shifts the video every time it changes state.
2. **Nothing responds on press.** The shared `Button` has no pressed state; feedback arrives on hover and after release. The only pressed feedback in the app is `active:scale-95` on three video buttons.
3. **Direct manipulation is simulated, not real.** Clip reorder is native HTML5 drag-and-drop: the browser's ghost image, no grab offset, no live neighbour movement, a 2 px insertion line, and no rollback when the save fails. The tip-off scrubber is a native range input driven by mouse events.
4. **The editor breaks at the window's own minimum size.** At 1280×720 the clip list shows only Period, Clock and Event; Player and Team are cut off. The toolbar wraps to two or three rows depending on the Export button's label, so every control moves when a selection changes. In Theater mode the list is below the fold entirely.
5. **The video element is recreated on a layout toggle.** Split and Theater are two keyed panel groups, so switching remounts `<video>`, which silently detaches the auto-advance effects.
6. **Keys have several owners.** Space is handled by every mounted `VideoClipControls`; the editor's and the Add Clips browser's arrow-key listeners are both live while the browser is open. `F` with no playlist open puts the window into native fullscreen with nothing to show.
7. **The chrome is a web page, not a Mac window.** A title bar strip sits above a 56 px icon rail whose labels exist only as tooltips; the space header has `backdrop-blur` but nothing ever scrolls under it; the update banner overlays everything; the appearance toggle is a binary sun/moon in the navigation, and "System" is reachable only from the native menu.
8. **One colour, three meanings.** The brand amber (`--accent`) is the hover fill of ghost and outline buttons and menu items, the "live/attention" colour on stat tiles, and the warning colour. Hovering "Play Playlist" turns it amber.
9. **Three typefaces, one of them fetched from Google Fonts at runtime.** Barlow Condensed is applied to every `h1`–`h3`, including 24 dialog titles; 25 micro-labels are uppercase with wide tracking; `<title>SuperCoachAI</title>` and a Vite favicon ship in the HTML.
10. **Reduced motion is ignored** except by Sonner. A theme switch tweens about 1,500 colour transitions at once, `animate-pulse` is used as an attention signal, and smooth `scrollIntoView` is unconditional.

Severity in the tables below: **High** = felt on every session of the daily path; **Medium** = felt weekly or by a subset; **Low** = polish.

## 2. Walkthrough by screen

Paths are relative to `apps/desktop`.

### 2.1 Shell: window, sidebar, space header, banners

What it shows: a native title bar; a 56 px icon rail (104 px with a second column of space tiles when the user belongs to two or more spaces); a top strip with the space name, plan badge and import quota; a fixed update banner when an update exists; a red licence banner for clubs in grace.

| Finding | Where | Severity |
|---|---|---|
| Labels exist only as tooltips; the rail has no `aria-label`s | `src/components/app-sidebar.tsx:61-88` | High |
| The sun/moon toggle flips light/dark; "System" only in View › Appearance | `app-sidebar.tsx:246-260`, `menu-handler.tsx:123-131` | Medium |
| Sign out as a rail icon next to Settings; Add Game as a "+" in the utilities | `app-sidebar.tsx:225-298` | Medium |
| `SpaceHeader` has `bg-background/60 backdrop-blur` but sits above the scroll container; nothing scrolls under it | `space-header.tsx:83`, `root-layout.tsx:18-36` | Low |
| Update banner is `fixed top-0 z-50`, covering the title area | `UpdateChecker.tsx:83` | Medium |
| Route change fades the new page in over 120 ms; the old page unmounts instantly; scroll position resets | `root-layout.tsx:28-36` | Low |
| Window is a plain decorated window: no overlay title bar, no vibrancy, no window-state persistence | `src-tauri/tauri.conf.json:13-23` | Medium |
| `<title>SuperCoachAI</title>`, favicon `vite.svg`, Geist and Geist Mono loaded from Google Fonts | `index.html:5-10` | Low |

### 2.2 Home

What it shows: "Home" title with three buttons (Invite players, New playlist, Import game); a "NEXT UP" card; "Team engagement" tiles; a 3×2 grid of playlist cards; recent imports.

| Finding | Where | Severity |
|---|---|---|
| Three equal-weight header actions plus a hero card compete for the first glance | `src/pages/home.tsx:222-264` | Medium |
| Uppercase tracked micro-label "NEXT UP"; "SHARED" chips in uppercase | `home/next-action-hero.tsx`, `home.tsx` | Low |
| Playlist cards are a grid of cards with no hover or pressed state and no keyboard focus | `home.tsx:281-327` | Medium |
| The amber tile ("players haven't finished") is the same amber as button hover | `home/team-engagement.tsx` | Low |

### 2.3 Library

What it shows: "Library" with a subtitle, a full-width search field, a bordered list of games (title, teams, date, clip count, Synced).

| Finding | Where | Severity |
|---|---|---|
| Rows react to hover only; no pressed state, not focusable, no context menu | `src/components/match-row.tsx:7-111` | Medium |
| Title set in Barlow Condensed bold with wide tracking next to DM Sans metadata | `match-row.tsx:30,43,45` | Low |
| Search is an in-page field rather than a toolbar field | `src/pages/matches.tsx:76-169` | Low |

### 2.4 Import game and tip-off

What it shows: two numbered steps. Step 1 picks a game (Your team / All games segmented control, season, league, a list). Step 2 links a video (a dashed "Choose a video file" zone that opens the native picker) and shows the tip-off picker: a suggestion strip, the video, a range-input scrubber, transport buttons, and "Set tip-off here".

| Finding | Where | Severity |
|---|---|---|
| The suggestion strip swaps states instantly (checking → detecting → found) and each swap shifts the video below it | `src/components/tipoff-suggestion-strip.tsx:50-137` | High |
| The scrubber is a native `<input type=range>` with mouse events; no tooltip, no frame step, no rubber-band | `src/components/sync-point-picker.tsx:241-261` | High |
| "Use m:ss.d" (the suggestion) and "Set tip-off here" have equal weight; the found tip-off auto-seeks silently | `tipoff-suggestion-strip.tsx:77-131`, `use-tipoff-suggestion.ts:178,227` | Medium |
| `GeneratingSession` advances through four steps every 700 ms regardless of real progress | `src/components/generating-session.tsx:31-44`, `upload-zone.tsx:334-342` | High |
| `ImportSuccessDialog` navigates away while still open; it vanishes with the page | `src/components/import-success-dialog.tsx:57-65` | Medium |
| The file "zone" is a dashed box that only opens a native picker; no pressed feedback, no materialised success state | `upload-zone.tsx:874-919` | Low |
| Validation messages pop in and out, pushing the submit button | `upload-zone.tsx:958-986` | Low |

### 2.5 Game settings (`/matches/:id`)

What it shows: a centred form: title, date, team colours, video file, tip-off picker, rosters, danger zone. Every field saves on blur with a "Saved" indicator.

| Finding | Where | Severity |
|---|---|---|
| The "Saved" indicator mounts and unmounts; its fade class never runs | `src/pages/match-detail.tsx:346` | Low |
| Team colour swatches `hover:scale-110` with no pressed state | `match-detail.tsx:77` | Low |

### 2.6 Playlists editor

What it shows: a collapsible playlist browser (folders, playlists, sections, search, New Playlist); the playlist header (name, count, Split/Theater toggle); a toolbar card (Pre/Post inputs, Add Clips, Filter, Add Text Card, Play Playlist, Export ▾, Share); a selection strip when rows are checked; an optional filter strip; a table of clips; the player (video, clip timeline, transport card, Pre/Post ±1 s, Vertical crop, labels, note).

| Finding | Where | Severity |
|---|---|---|
| At 1280×720 the table shows only Period, Clock, Event; Player and Team are cut off behind a horizontal scroll (`min-w-[580px]`) | `src/pages/playlists.tsx:5624-5740` | High |
| The toolbar wraps to 2 or 3 rows depending on the Export label ("Export playlist" / "Export 1 selected"); every button moves when the selection changes | `playlists.tsx:5295-5462` | High |
| In Theater mode at 1280×720 the clip list is below the fold | `playlists.tsx:6133-6147` | High |
| The selection strip is static: selecting a row pushes the whole list down by its height | `playlists.tsx:5463-5564` | Medium |
| Reorder is native HTML5 DnD: browser ghost, no grab offset, `opacity-40` source, 2 px insertion line, no live movement; `reorderItems` has no rollback | `playlists.tsx:316-332, 3225-3444, 3119-3131` | High |
| Clicking a row plays it; rows are `<tr onClick>` with no `tabIndex`, no keyboard selection, no Delete key | `playlists.tsx:253-497` | Medium |
| Bulk remove has no Undo while single remove does | `playlists.tsx:4738-4758, 4779-4793` | Medium |
| Split/Theater toggle remounts the `<video>` (keyed panel groups) and detaches auto-advance | `playlists.tsx:6132-6164` | High |
| `react-resizable-panels` v4 sizes are pixels; `defaultSize={22} minSize={15}` are passed as percentages | `playlists.tsx:5752-5753`, `ui/resizable.tsx` | Medium |
| Browser panel collapse (⌘B) is an instant jump | `playlists.tsx:5066-5074` | Low |
| Playlist selection is forgotten when navigating away and back | `playlists.tsx` (observed) | Medium |
| `AddToDropdown`, the speed menu and the filter dropdowns are hand-rolled: not portaled, no animation, no Escape or arrow keys | `playlists.tsx:1545-1665`, `video-clip-controls.tsx:149-179`, `ui/multi-select-dropdown.tsx` | Medium |
| Context menu opens with an animation and closes with a cut | `ui/context-menu.tsx:21,75` | Low |
| Disabled-reason tooltips never show (`disabled:pointer-events-none`) | `ui/button.tsx:8`, `playlists.tsx:5345,5390,5451` | Medium |
| Export errors render as an inline red line under the toolbar | `playlists.tsx:5459-5461` | Low |
| `alert()` when creating a folder fails; `window.confirm` when deleting a label | `playlists.tsx:4010`, `labels/LabelPickerPopover.tsx:341` | Low |

### 2.7 Player

| Finding | Where | Severity |
|---|---|---|
| A click on the video does nothing; no play/pause glyph; the icon swaps on media events, not on press | `src/components/video-player.tsx:94`, `video-clip-controls.tsx:53-68` | High |
| No buffering indicator; cross-game source swaps show nothing | `playlists.tsx:2370-2402` | Medium |
| The clip timeline seeks on every `pointermove` unthrottled; hard clamp; no tooltip; the readout can exceed the clip length (0:35 / 0:13 observed) | `src/components/crop-editor.tsx:178-276` | Medium |
| Transport sits in a card under the video; in fullscreen a different floating bar is used | `video-clip-controls.tsx:116`, `playlists.tsx:5153-5217` | Low |
| Space is handled at document level by every mounted controls instance; the editor's and the browser's arrow listeners are both live while Add Clips is open | `video-clip-controls.tsx:101-113`, `playlists.tsx:3048-3089, 1107-1129` | High |
| Nothing is bound to →; J/K/L exist only in the tip-off picker, as single steps | `playlists.tsx:3048-3089`, `sync-point-picker.tsx:168-199` | Low |
| `F` with no playlist open enters native fullscreen with nothing to show | `src/lib/use-player-fullscreen.ts` (observed) | Medium |
| Trim is ±1 s buttons; no handles on the timeline | `video-clip-controls.tsx:194-213` | Low |

### 2.8 Add Clips

What it shows: a near-fullscreen dialog with a filter row (Game, Event type, Shot type, Situation, Team, Player, Leaders, Labels, Pre-roll, Post-roll, "N events"), a resizable split of an event table and a preview player.

| Finding | Where | Severity |
|---|---|---|
| Nine filters and two inputs are always visible; the primary action "Add clips" is disabled and grey until a row is checked | `playlists.tsx:1173-1339` | Medium |
| The dialog zooms from the screen centre, like every dialog | `ui/dialog.tsx:64` | Medium |
| Rows are `draggable` but can never reach a drop target behind the modal scrim | `playlists.tsx:1395-1407` | Low |
| The outside-click guard checks a stale attribute, so releasing a panel resize outside closes the dialog | `playlists.tsx:6171` | Medium |
| Event badges are wrapped two-line pills ("Shot Clock", "Off Rebound") in a narrow column | observed | Low |

### 2.9 Export, Send to phone, Share

| Finding | Where | Severity |
|---|---|---|
| The Share dialog swaps three phases (pick / uploading / resolve) with instant height changes | `playlists.tsx:6229-6313` | Medium |
| Send to phone has no Cancel while uploading; export cannot be cancelled while rendering | `send-to-phone-dialog.tsx`, `src-tauri/src/lib.rs:303` | Medium |
| Progress bars animate `width` with `transition-all` | `ui/progress-bar.tsx:28-29` and five inline bars | Low |
| The two Share dialogs (editor and Shared Playlists) differ in sections, footer and error handling | `playlists.tsx:6229-6437`, `my-playlists.tsx:1132-1243` | Low |

### 2.10 Shared playlists, Settings, Profile, Organization

| Finding | Where | Severity |
|---|---|---|
| Settings: five padded cards, each with a heading and a paragraph; the watermark toggle is a native checkbox | `src/pages/settings.tsx:41-138` | Low |
| Profile: a decorative gradient band; a dashed "sign out" card; account settings live here while Settings holds app settings | `src/pages/profile.tsx:216-498` | Low |
| Organization: tabs activate on mousedown (good), but the member role filter is a native `<select>` | `src/pages/organization.tsx:687-688, 800` | Low |
| Shared playlists: the feed heading says "My Playlists" for coaches whose navigation says "Shared Playlists" | `playlist/PlaylistFeed.tsx:132` | Low |

### 2.11 Auth and onboarding (from code)

Centred cards under the logo; Google and Apple buttons open the system browser. With an overlay title bar these screens must carry their own drag region or the window cannot be moved from them.

## 3. Findings by principle

| Principle | Finding | Severity |
|---|---|---|
| Response | No pressed state on `Button`; feedback on hover and after release | High |
| Response | Click on the footage does nothing; no play/pause glyph; no buffering indicator | High |
| Response | Import progress is a timer, not progress | High |
| Response | Scrubber seeks unthrottled; tip-off scrubber is a mouse-driven range input | Medium |
| Direct manipulation | Native HTML5 drag for clip reorder: ghost image, no grab offset, no 1:1 movement, no rollback | High |
| Direct manipulation | No trim handles; ±1 s buttons | Low |
| Interruptibility | No springs anywhere; 150 ms CSS tweens; menus cut on close | High |
| Interruptibility | Share dialog phases jump; tip-off strip jumps the video; success dialog vanishes with the page | Medium |
| Springs / behaviour | Panel collapse, selection strip, filter strip and theater toggle are instant layout jumps | Medium |
| Spatial consistency | Dialogs scale from the screen centre, not the trigger; menus have an enter path and no exit path | Medium |
| Spatial consistency | Update banner overlays the top; selection strip pushes the list | Medium |
| Materials | Opaque chrome; a blurred header nothing scrolls under; sticky headers without material | Medium |
| Materials | Brand amber doubles as hover fill and as the attention colour | Medium |
| Typography | Three families, one fetched at runtime; condensed face on every heading and dialog title; uppercase tracked labels; no size-specific tracking | Medium |
| Typography | Fixed-width columns clip Player and Team at the minimum window size; toolbar wraps | High |
| Reduced motion | Not honoured (two `motion-safe:` fades only); theme switch tweens everything | Medium |
| Familiarity | Icon rail with tooltip labels; binary appearance toggle in navigation; sign-out icon in the rail; no native chrome; no window-state persistence | High |
| Wayfinding | "Add Game" / "Import game" / "Import Game"; title case vs sentence case; "My Playlists" for coaches; Q5 vs OT1; playlist selection forgotten on navigation | Medium |
| Agency | `alert()` and `window.confirm`; bulk remove without Undo; no cancel for uploads or renders | Medium |
| Simplicity | Editor toolbar shows every control at once; Add Clips shows nine filters at once | Medium |
| Craft | `<title>SuperCoachAI</title>`, Vite favicon; dead components; `@dnd-kit` installed and unused; panel sizes in the wrong unit; `rounded` vs `--radius`; emoji in copy; duplicate key listeners; `F` fullscreen with nothing to show | Medium |
| Accessibility | Rail without `aria-label`s; rows not focusable; 94 `title` tooltips; focus rings missing on custom buttons | Medium |

## 4. Rules from the landing site's DESIGN.md deliberately dropped, and why

| Rule | Dropped because |
|---|---|
| No shadows, glass, blur or gradients | Apple's materials convey hierarchy through translucency and depth. A toolbar the content scrolls under, a menu with a soft shadow and a sheet with a dimmed backdrop are how a Mac app tells structure from content. |
| Hairlines as the only structure | Grouped inset lists and materials carry structure with less visual noise than lines everywhere; hairlines remain inside groups. |
| Barlow Condensed for every heading and figure | The platform font ships optical sizes, tracking tables and tabular figures, and matches every other app on the Mac. The brand lives in the wordmark. |
| "The clock is mono" | Tabular figures in the system font align clocks and counts without a second family; `ui-monospace` (SF Mono) stays for file names and codes. |
| Cyan is the only action colour, amber is only "live" | A single accent colour for selection and primary actions is the macOS convention; amber returns to meaning warning/attention only, never hover. |
| The unbroken ground, no cards | A vibrancy sidebar and grouped lists are a different ground on purpose: they are what makes the window read as a Mac window. |
| The icon rail | A source list with labels is the macOS sidebar; labels are not a tooltip. |
| Uppercase tracked labels | Apple uses weight and size for hierarchy, not caps. |

Kept from DESIGN.md: no eyebrow labels above headings (Apple agrees), league names in type, sentence-case copy, the event colour semantics (make/miss/rebound/assist/steal/block/turnover/foul), and the anchoring on the official record.

## 5. Kept on purpose

- Every capability of 0.7.0: import, tip-off suggestion, reorder with multi-selection blocks and groups, drops onto sidebar playlists and folders, text cards, trims, notes, labels, grouping, filters, export in 16:9 and 9:16, send to phone, share with who-watched, fullscreen, the onboarding highlight ring.
- Keyboard shortcuts and the native menu (⌘1–5, ⌘B, ⌘E, ⌘O, ⌘N, ⌘⇧F, zoom), extended rather than replaced.
- The eight colour themes and cross-device sync.
- The event colour palette and the Free-plan watermark.
- Windows: standard window, opaque sidebar, same layout.

## 6. What the redesign does

Filled in at the end of the branch (M6): principle → change, with the file that carries it.

## 7. Known gaps and next steps

Filled in at the end of the branch (M6).
