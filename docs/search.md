# Search

The desktop app has one search over the space a coach is in: a panel in the
upper part of the window with a field and what it finds under it. It finds
playlists, reports and games by name and opens the one chosen. It is a
search, not a command palette: it lists things, not actions.

Each page keeps its own search field (Library, Reports, the playlist
browser). Those filter the view one is on; this one goes anywhere.

## Opening it

- **⌘K** on macOS, **Ctrl+K** on Windows. The same chord closes it.
- **Search** at the top of the sidebar, with the chord beside it, so it is
  found without knowing the chord.
- **Go > Search…** in the macOS menu bar.

On macOS the chord is the menu item's accelerator
(`apps/desktop/src-tauri/src/menu.rs`); on Windows, which has no menu bar,
`packages/shared/lib/menu-shortcuts.ts` reads it from the keyboard. Both end
in `runMenuAction("search")` in `components/menu-handler.tsx`.

It is there for the roles the sidebar lists Home, Playlists and the Library
for (coach or admin, a personal space included), and only once the page
itself is shown. It stays out of the way of anything else that is open: over
another dialog, a sheet, a popover or a menu the chord does nothing.

## What it shows

**Before a query:** *Recent*, up to eight things opened last on this computer,
newest first, each with its kind to the right. On a computer where nothing
has been opened yet it lists the three newest of each kind instead.

**With a query:** groups in the sidebar's order, *Playlists*, *Reports*,
*Games*, five of each at most; a group that holds back says so ("5 of 12").
Typing more is how one reaches the rest.

| Kind | Found by | To the right of its name |
|---|---|---|
| Playlist | its name, and the folders it is in | the folder path |
| Report | its title, and its playlist's name | the playlist's name when it differs, then the status the Reports list gives it |
| Game | its title and both teams' names | the day it was played; "Archived" first for an archived game |

A report is its playlist's (one per playlist), so its id is the playlist's
id; kind and id together name a thing.

## How a query matches

`packages/shared/lib/quick-search.ts`, pure and under vitest.

- Every word must be found, in any order.
- Case and accents are ignored (`foldForSearch`): "sodertalje" finds
  Södertälje.
- In a group, best first:
  1. games in the Library before archived ones,
  2. a name that starts with what was typed, then a name in which every word
     starts a word, then a name that holds every word, then a match only in
     the folders, the playlist's name or the teams,
  3. what was opened last on this computer,
  4. the newest (a game's day, a playlist's creation, a report's last change).

There is no typo tolerance. The lists are a coach's own names, a few hundred
at most, and a search that only finds what was typed is easier to trust.

A game is not matched on its date: a typed date has no one form.

## Keys and pointer

↑ and ↓ move the highlight, ↩ opens, esc closes. The field keeps the focus
and the list is moved through with `aria-activedescendant`, the pattern of
the Add clips game picker. A row takes the highlight from the pointer only
when the pointer moves, not when the list changes under a resting one.

When the panel is dismissed the keys go back to where they were at once, not
when its motion ends. After a choice they are left to the page that opens.

While it is open the page's own keys (Space, the arrows, A, G) are off, as
under any dialog (`lib/key-scope.ts`). A video behind it keeps playing.

## Opening what was chosen

- **Playlist:** the Playlists page with it selected, on its clips.
- **Report:** the Playlists page with it selected, in its Report view.
- **Game:** the game page. A game that already has a tab goes to that tab
  with what the tab remembers; on the game page the switch replaces the
  history entry, as the tabs do.

A playlist or report is asked for through the Playlists page's router state
(`restore`, `view`). The page read that state only as it was built, and a
navigation to the page one is on builds nothing, so the page now also opens a
later arrival in place, the way a click in its list does (`openAsked` in
`pages/playlists.tsx`). A playlist newer than the page's list makes it read
the list once more.

## What was opened last

`packages/shared/lib/recent-opens.ts` and `apps/desktop/src/lib/recent-opens.ts`:
twenty entries per user and space in localStorage, one per thing. The pages
note an open where it happens (the selected playlist, the Report view, the
game page), so the list is what was really opened, however one got there.
It never leaves the computer.

## What it costs

The panel's code is fetched the first time it opens. Nothing is read before
that.

Each open reads the space's index in five parallel requests:

| Read | Columns |
|---|---|
| playlists (`listPlaylistIndex`) | id, name, folder, created |
| folders (`listFolders`) | the rows |
| published reports (`listMyScoutingReports`) | id, playlist, title, dates, opens |
| report drafts (`listReportDraftTitles`) | playlist, updated, title |
| games (`listMatchIndex`) | id, title, day, the teams, created, archived |

None of them reads a clip, a roster, game marks or a play, which is what the
pages' own loads carry. The index is kept in memory
(`apps/desktop/src/lib/quick-search-store.ts`) with every name folded once,
so a keystroke is a few hundred string comparisons and no request, with no
debounce. At most fifteen rows are drawn.

Nothing announces a renamed playlist or a new report, so the index is read
again on every open; the one held shows meanwhile. One space is held at a
time.

The scrim only dims and the panel is opaque: no blur is drawn over a video
that keeps playing.

Hosted Supabase returns at most 1,000 rows a request. A space with more
playlists or games than that would be searched in part.

## Reported

`search_opened` (via: shortcut or sidebar) and `search_result_opened` (kind,
from: recent, newest or results, position, query_length). What was typed is
never sent.

## Not there yet

- Actions (New playlist, Import game).
- Searching inside things: clips, players, labels, notes. That can't be done
  from memory (a game's plays are about 225 KB), so it needs a search in the
  database.
- Other spaces than the one shown.
- Players in a club space, whose pages are different ones.
- Web and mobile.

## Tests

`packages/shared/lib/__tests__/quick-search.test.ts`, `recent-opens.test.ts`
and `quick-search-reads.test.ts`; `apps/desktop/headless/specs/K-search.spec.ts`
for the panel in WebKit and Chrome, including that nothing is read before
the first open and nothing while typing. The native menu is mocked in the
headless runs, so ⌘K itself is checked in `tauri dev`.
