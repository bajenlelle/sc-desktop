# Profixio games

Profixio runs the protocols of SBBF's district leagues and the youth SM. The
desktop imports its games beside the Genius ones (SBF's national leagues).
The code: `packages/shared/lib/profixio*.ts`, `lib/profixio-import.ts`, the
`profixio` edge function (`supabase/functions/profixio`), and the cache tables
in `20261002100000_profixio_import.sql`.

## The catalogue

The function reads Profixio's documented API with `PROFIXIO_API_SECRET`. The
key can't list the federation's tournaments: it sees the ones Profixio has
granted it (`/api/userinfo` → `specificTournaments`), one per series and
season. A new season, or a series that isn't there, needs Profixio (SBBF) to
grant it to the key; the catalogue picks it up on its next refresh, with no
code change. A league outside the grant answers `unknown_league`.

The importer's league picker (`useLeagues({ withProfixio: true })`) lists the
granted series under their district. Everything else that reads leagues
(Teams pages, game stats, reports, game marks) stays on Genius competitions.
A season's stages are its categories ("Nivå 1", "Nivå 2A"…), fetched once
the season is picked; only played games are offered. "Your games" is Genius
only: Profixio teams aren't in `league_teams`.

## Sync: the first basket

The table presses "Start period 1" when it opens the protocol, minutes before
the jump ball (measured 3:37 to 4:00), so a Profixio game has no tip-off time.
Its sync reference is the first made basket (`findProfixioSyncAnchor`): the
importer and the game page ask for a basket from the start (the first-basket
picker, `components/first-basket.tsx`, with `basketFirst`), and the coach
steps to a later one when the first isn't in the video. The tip-off detector
and the shared tip-off hints stay off: a jump ball found in the video would be
paired with the basket's wall clock. Q1 keeps no start time (the early press);
later quarters keep the table's.

The table types plays in after they happen: from 12 s before to 4 s after the
stamp around the basket, 30 s at worst. Clips keep the Genius pre- and
post-roll (10 s and 3 s); Check sync plays from 20 s before a play and asks
whether it happens in the seconds before its mark (`checkWindow`).

## What the protocol records

Made baskets (2, 3 and free throws), fouls (with the FIBA variants) and
timeouts. No misses, rebounds, assists, turnovers, shot positions or fives,
and in district games no game clock: plays are ordered by the wall clock, and
the moments read off the clock (quarter starts and ends, clutch) are off. A
clock that counts up is dropped for its period (`withCountdownClocks`), since
the app reads clocks as countdowns.

## Players

Profixio's personIds are numbers from the same range as Genius's. A Profixio
play marks its player (`player.source: "profixio"`), and a person is keyed by
`personKey` (`"px:<id>"`) and `playerKey` (`"px:<id>"` in the play filters),
so a Profixio player never merges with a Genius one in a report, a roster or
a filter. Photos and season lines are looked up by bare Genius ids only.
