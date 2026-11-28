# Navigation: links between pages, and Back

The desktop app moves between its pages as Notion or Music does: what names a game or a team opens it, and
Back returns to the page before, as it was left.

## Back is the page before

- **History, not hierarchy.** The app keeps its own record of the pages walked
  (`packages/shared/lib/nav-history.ts`, `apps/desktop/src/lib/nav-history.ts`). Back and Forward step through
  it as Safari's and Finder's do: a game opened from a team's plays goes back to those plays, a team opened from
  a game goes back to the game.
- **The toolbar's "‹ {page}".** It names the page it returns to (each page names itself with `usePageTitle`) and
  collapses to the chevron in a narrow toolbar. With nothing behind (the app started on the page, a reload), a
  detail page goes up to its place instead: a game to Games, a team to Teams, a report to Reports
  (`Toolbar`'s `back` prop). A page the sidebar or the Go menu's numbered pages opened is a fresh start and shows
  no button; the keys still go back.
- **A page names only its own entry.** A navigation renders as a transition (React Router 7): the page being left
  stays on screen, and can render again, after the history has stepped to the next page. `useNavEntryId` reads
  the entry by the page's own location key (`idOfKey` in `lib/nav-history.ts`), never the entry now current, so a
  page left never names the next one after itself ("‹ Frysen good plays" on a report reopened from Reports) or
  keeps its memory (`lib/page-memory.ts`) there. `F-back-names-page` guards it; the race shows in the real app
  more than in a headless run.
- **Keys and buttons.** Go → Back ⌘[ and Forward ⌘] (on while there is a page that way); ⌘← and ⌘→ outside text
  fields (for layouts where [ takes ⌥, Swedish among them); Alt+← and Alt+→ on Windows; the mouse's side buttons.
- **A page's own views don't count.** Season | Plays (Watch included), Game | Stats | Details and a switch between
  open games replace the entry: Back leaves the page, it doesn't flip its views.

## Coming back finds the page as it was

What a page kept is kept per history entry, in memory (`apps/desktop/src/lib/page-memory.ts`): a page shown
again from the history gets it back, a new visit starts fresh.

- Every `PageContent` scroller keeps its position, put back once the content is tall enough.
- A team's Plays keeps its filters, its ticked games, its selection, the play on the stage (shown again at its
  start, paused) and the list's scroll.
- The editor opens the playlist it was left on.
- The game page keeps its own memory per game as before (`lib/game-tabs.ts`).

## Names are links

`components/entity-link.tsx`: `GameLink` and `TeamLink`, one look for every name of a game or a team.

- **Look.** The text's own colour, underlined while pointed at or focused, dimmed while pressed. No accent
  colour: that is for controls.
- **In a row.** A row that plays or selects keeps its press; only the name is the link, and its press is its own
  (no play, no selection, no drag). A link never sits inside a button or another link.
- **⌘-click** (Ctrl-click) or the middle button puts the game in Open games (the team in Open teams) and leaves the
  page as it is.
- **Row menus** add where one play leads: Show in game, Go to {team}.

Where names open what they name:

| Where | Name | Opens |
| --- | --- | --- |
| Team · Plays, a game's header | the opponent / the day and result | their team / the game |
| Team · Plays, the Now bar | the game | the game at that play |
| Team · Plays, a play's menu | Show in game / Go to {opponent} | the game at the play / their team |
| Team · Season | "You beat them 78–71 on 15 Nov." | that game's Stats |
| Team · Games | the opponent / Imported | their team / the game |
| Game · Stats | every team name (score, factors, players, shots, lineups) | the team |
| Game · a play's menu | Go to {team} | the play's team |
| Editor | the subtitle's game, a clip's game (several games) | the game, at the clip |
| Editor | the sync warning's game | the game |
| Shared playlists | the game under the player, a clip's game | the game at that play (coaches) |
| Report | the arrow beside the opponent, a clip's game | the team, the game at the clip |
| Profile | your team | its page |

Not linked, on purpose:

- **Players.** There is no player page; a name opens the player's plays, as before.
- **Rows that are already one link or button** (the Library's games, the Reports list, the import list): a link
  can't sit inside them.
- **Filters and pickers**, whose names choose rather than go.
- **The game's Details subtitle**: the toolbar hides a text subtitle as it narrows, which a subtitle of links
  would stop.
