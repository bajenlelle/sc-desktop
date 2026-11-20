import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gameOrder } from "@scoutable/shared/lib/game-flow";
import { EMPTY_GAME_FILTERS, type GameFilters } from "@scoutable/shared/lib/game-list";
import { GameStatsView } from "@/components/game/stats/game-stats-view";
import type { OpenKind, PlaySet } from "@/components/game/stats/stat-cell";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { recentOpensScope, rememberOpened } from "@/lib/recent-opens";
import { Loader2 } from "lucide-react";
import { GameBackButton } from "@/components/game/game-toolbar-parts";
import { GameViewSwitch, type GameViewMode } from "@/components/game/game-view-switch";
import { GameWatchView } from "@/components/game/game-watch-view";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { useAuth } from "@/lib/auth-context";
import {
  announceClosedGameTab,
  forgetGameTab,
  gameTabsScope,
  recallGameView,
  recallLoadedGame,
  rememberGameTab,
  rememberGameView,
  rememberLoadedGame,
  useGameTabs,
} from "@/lib/game-tabs";
import { getMatch, listMatchesByIds } from "@/lib/matches-db";
import { isLocalPath } from "@/lib/stream";
import { probeVideoPath, type VideoFileStatus } from "@/lib/video-probe";
import type { StoredMatch } from "@/types/match";
import { MatchDetailPage } from "./match-detail";

/**
 * The game page (`/matches/:id`), in two views of the same game behind one
 * switch: Game (the whole game: footage, plays, timeline; GameWatchView) and
 * Details (title, video, sync, rosters; MatchDetailPage, as it always was).
 *
 * A game opens on Game when its video plays on this computer and it is
 * synced, since that is what a coach comes for; otherwise on Details, where
 * the video is linked and the tip-off set. `?view=` names a view outright,
 * and every link that asks for the quarters lands on Details.
 *
 * Only one view is mounted at a time: Details' tip-off picker has a video of
 * its own, and two decoders on one file is how paused frames go black
 * (lib/release-video.ts). The game is read again each time the Game view is
 * entered from Details or from outside, so a sync, a video or a title changed
 * in Details is what it shows; a tab switch serves the copy read on this
 * visit (lib/game-tabs.ts) until any `matches-changed`, or for ten minutes.
 *
 * The open games (one game is one tab) are rows in the sidebar's Open games,
 * per user and space, there from any page (components/shell/open-games.tsx).
 * Switching from one game to another replaces the history entry, so Back
 * leaves the games. A switch opens the view the game was left on
 * (lib/game-tabs.ts). A game opened from a playlist goes back to it: the
 * toolbar's back button names the playlist (GameBackButton).
 */
export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useGameTabs(scope);

  const asked = searchParams.get("view");
  const wantsQuarters = !!(location.state as { openQuarters?: boolean } | null)?.openQuarters;
  const via = (location.state as { via?: string } | null)?.via;
  // A tab switch: by the tab bar, by a game marked Open in the Library, or by the search finding a game that has a tab.
  const viaTab = via === "tab" || via === "library_tab" || via === "search_tab";
  const startEventId = Number(searchParams.get("play")) || null;
  // Opened from a playlist (the editor's Show in Game, a game in its subtitle): Back goes to it. Opened any other
  // way but a switch between open games (the sidebar's rows, the keys, the menus), Back is the Library's again.
  useState(() => {
    const from = (location.state as { from?: { playlistId?: unknown; title?: unknown; path?: unknown } } | null)?.from;
    if (from && typeof from.playlistId === "string") {
      rememberGameView(matchId, {
        from: {
          playlistId: from.playlistId,
          title: typeof from.title === "string" ? from.title : "Playlist",
          path: from.path === "/my-playlists" ? "/my-playlists" : "/playlists",
        },
      });
    } else if (via !== "tab") rememberGameView(matchId, { from: null });
    return null;
  });
  // A tab switch shows the game as this visit read it, without the spinner.
  const [loaded, setLoaded] = useState<{ match: StoredMatch; videoStatus: VideoFileStatus | "none" } | null>(() =>
    viaTab ? recallLoadedGame(matchId) : null,
  );
  const [view, setView] = useState<GameViewMode | null>(() => {
    if (asked === "details" || wantsQuarters) return "details";
    if (asked === "stats") return "stats";
    if (asked === "game" || startEventId) return "game";
    // A tab switch comes back to the view the game was left on.
    const left = viaTab ? recallGameView(matchId)?.view : null;
    if (left) return left;
    // Nothing asked for a view: the game when there is one to watch, else its settings.
    if (loaded) return loaded.videoStatus === "ok" && loaded.match.syncPoint ? "game" : "details";
    return null;
  });
  const [entry] = useState(
    via === "library_tab" ? "library_tab" : via === "search" || via === "search_tab" ? "search" : viaTab ? "tab" : via === "picker" ? "picker" : asked || startEventId ? "link" : "library",
  );
  const [missing, setMissing] = useState(false);
  // The cached copy stands in for the first read only; Details and back reads afresh.
  const fromCache = useRef(loaded !== null);

  // The plays behind a number in Stats, handed to the Game view as one filter (router state, so a reload keeps it).
  // What a number in Stats hands the Game view: the play to open on and its plays as one filter.
  const [handoff, setHandoff] = useState<{ eventId: number | null; filters: GameFilters | null } | null>(null);
  // The same, read back from the router after a reload. The Game view reads it once, when it mounts.
  const pickedFilters = useMemo<GameFilters | null>(() => {
    const picked = (location.state as { picked?: { name?: unknown; eventIds?: unknown } } | null)?.picked;
    return picked && typeof picked.name === "string" && Array.isArray(picked.eventIds)
      ? { ...EMPTY_GAME_FILTERS, picked: { name: picked.name, eventIds: new Set(picked.eventIds as number[]) } }
      : null;
  }, [location.state]);

  // The game and whether its video plays here: read on arrival (to choose the
  // view) and again whenever the coach comes back from Details.
  useEffect(() => {
    if (view === "details") {
      fromCache.current = false;
      return;
    }
    if (fromCache.current) return;
    let cancelled = false;
    setLoaded(null);
    void (async () => {
      try {
        const match = await getMatch(matchId);
        if (cancelled) return;
        if (!match) {
          setMissing(true);
          return;
        }
        const url = match.videoUrl;
        const videoStatus: VideoFileStatus | "none" = !url ? "none" : isLocalPath(url) ? (await probeVideoPath(url)).status : "ok";
        if (cancelled) return;
        setLoaded({ match, videoStatus });
        rememberLoadedGame(matchId, { match, videoStatus });
        // Nothing asked for a view: the game when there is one to watch, else its settings.
        setView((v) => v ?? (videoStatus === "ok" && match.syncPoint ? "game" : "details"));
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Entering the Game view is what reads the game; leaving it needs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, view === "details"]);

  const show = useCallback(
    (next: GameViewMode, state?: { openQuarters?: boolean }) => {
      setView(next);
      // The switch opens a view as it was left; plays handed over from Stats were for that one visit.
      setHandoff(null);
      const params = new URLSearchParams(searchParams);
      params.set("view", next);
      params.delete("play");
      // The switch replaces the entry: Back leaves the game, it doesn't flip views.
      setSearchParams(params, { replace: true, state: state ?? null });
    },
    [searchParams, setSearchParams],
  );

  // A number in Stats opens its plays: the Game view, on the first of them, with them as one filter. A single
  // shot is one play and opens as a link to a play does, with no filter.
  const openPlays = useCallback(
    (set: PlaySet, meta: { kind: OpenKind }) => {
      if (!loaded || set.eventIds.length === 0) return;
      const ids = new Set(set.eventIds);
      const first = gameOrder(loaded.match.events.filter((e) => ids.has(e.eventId))).order[0];
      const params = new URLSearchParams(searchParams);
      params.set("view", "game");
      if (first) params.set("play", String(first.eventId));
      const picked = meta.kind === "shot" ? null : { name: set.name, eventIds: [...set.eventIds] };
      if (!picked) rememberGameView(matchId, { filters: EMPTY_GAME_FILTERS });
      setSearchParams(params, { replace: true, state: picked ? { picked } : null });
      // The Game view reads what it opens with once, at mount, and the URL lands a moment after the view flips:
      // the hand-off goes in the same update as the view.
      setHandoff({
        eventId: first?.eventId ?? null,
        filters: picked ? { ...EMPTY_GAME_FILTERS, picked: { name: picked.name, eventIds: ids } } : null,
      });
      setView("game");
    },
    [loaded, matchId, searchParams, setSearchParams],
  );

  // The view the game is on, however it was chosen (a link, the switch, the
  // game's own state), is the one a tab switch comes back to.
  useEffect(() => {
    if (view) rememberGameView(matchId, { view });
  }, [matchId, view]);

  // This game's tab, in the space it was opened in: a space switch while the
  // page is open doesn't plant it among the new space's tabs.
  const scopeAtMount = useRef(scope);
  const title = loaded?.match.title ?? "";
  const date = loaded?.match.date || null;
  useLayoutEffect(() => {
    scopeAtMount.current ??= scope;
    const madeRoom = rememberGameTab(scopeAtMount.current, { id: matchId, title, date });
    // The bar was full: a tab was closed without being asked. Say which, with the way back.
    if (madeRoom) announceClosedGameTab(madeRoom.title);
    // The title is what changes; the date comes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, title, scope]);

  // Opened straight on Details, the page never reads the game itself: a light
  // read names the tab when it has no title yet.
  const knownTitle = tabs.tabs.find((t) => t.id === matchId)?.title;
  // A game that has a name is a game that was opened: what the search offers as opened last (lib/recent-opens.ts).
  const named = !!(title || knownTitle);
  useEffect(() => {
    if (named) rememberOpened(recentOpensScope(user?.id, activeOrgId), "game", matchId);
  }, [named, matchId, user?.id, activeOrgId]);
  useEffect(() => {
    if (view !== "details" || loaded || knownTitle) return;
    let cancelled = false;
    void listMatchesByIds([matchId])
      .then(([match]) => {
        if (!cancelled && match) rememberGameTab(scopeAtMount.current, { id: matchId, title: match.title, date: match.date || null });
      })
      .catch(() => {
        /* a failed read leaves the tab unnamed until the game is read another way */
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, view, loaded, knownTitle]);

  useEffect(() => {
    // A game that isn't there has no tab, and isn't one to reopen.
    if (missing) forgetGameTab(scopeAtMount.current ?? scope, matchId, { reopenable: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, matchId]);

  const viewSwitch = <GameViewSwitch value={view ?? "game"} onChange={(next) => show(next)} />;

  // A game that isn't there is the Details view's to say (it has the empty state).
  if (view === "details" || missing) return <MatchDetailPage viewSwitch={missing ? undefined : viewSwitch} />;

  if (!loaded || view === null) {
    return (
      <Page>
        <Toolbar title="Game" leading={<GameBackButton matchId={matchId} />} />
        <PageContent width="narrow">
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading the game…
          </div>
        </PageContent>
      </Page>
    );
  }

  if (view === "stats") {
    return (
      <GameStatsView
        key={loaded.match.id}
        match={loaded.match}
        viewSwitch={viewSwitch}
        entry={entry}
        onOpenPlays={openPlays}
        onShowDetails={() => show("details")}
      />
    );
  }

  return (
    <GameWatchView
      // A different game is a different visit: its own video, position and filters.
      key={loaded.match.id}
      match={loaded.match}
      videoStatus={loaded.videoStatus}
      viewSwitch={viewSwitch}
      entry={entry}
      startEventId={handoff ? handoff.eventId : startEventId}
      startFilters={handoff ? handoff.filters : pickedFilters}
      // A number in Stats was clicked to watch its plays; a reload or a link opens paused.
      autoPlay={handoff !== null && handoff.eventId !== null}
      onOpenDetails={(opts) => show("details", opts)}
    />
  );
}
