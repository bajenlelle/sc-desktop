import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { GameTabStrip } from "@/components/game/game-tab-strip";
import { GameViewSwitch, type GameViewMode } from "@/components/game/game-view-switch";
import { GameWatchView } from "@/components/game/game-watch-view";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  forgetGameTab,
  gameTabsScope,
  neighbourGameTab,
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
 * The open games sit in tabs under the toolbar (from two games), per user and
 * space; switching replaces the history entry, so Back leaves the games. A
 * tab switch opens the view the game was left on (lib/game-tabs.ts).
 */
export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrgId } = useAuth();
  const scope = gameTabsScope(user?.id, activeOrgId);
  const tabs = useGameTabs(scope);

  const asked = searchParams.get("view");
  const wantsQuarters = !!(location.state as { openQuarters?: boolean } | null)?.openQuarters;
  const viaTab = (location.state as { via?: string } | null)?.via === "tab";
  const startEventId = Number(searchParams.get("play")) || null;
  // A tab switch shows the game as this visit read it, without the spinner.
  const [loaded, setLoaded] = useState<{ match: StoredMatch; videoStatus: VideoFileStatus | "none" } | null>(() =>
    viaTab ? recallLoadedGame(matchId) : null,
  );
  const [view, setView] = useState<GameViewMode | null>(() => {
    if (asked === "details" || wantsQuarters) return "details";
    if (asked === "game" || startEventId) return "game";
    // A tab switch comes back to the view the game was left on.
    const left = viaTab ? recallGameView(matchId)?.view : null;
    if (left) return left;
    // Nothing asked for a view: the game when there is one to watch, else its settings.
    if (loaded) return loaded.videoStatus === "ok" && loaded.match.syncPoint ? "game" : "details";
    return null;
  });
  const [entry] = useState(viaTab ? "tab" : asked || startEventId ? "link" : "library");
  const [missing, setMissing] = useState(false);
  // The cached copy stands in for the first read only; Details and back reads afresh.
  const fromCache = useRef(loaded !== null);

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
      const params = new URLSearchParams(searchParams);
      params.set("view", next);
      params.delete("play");
      // The switch replaces the entry: Back leaves the game, it doesn't flip views.
      setSearchParams(params, { replace: true, state: state ?? null });
    },
    [searchParams, setSearchParams],
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
    rememberGameTab(scopeAtMount.current, { id: matchId, title, date });
    // The title is what changes; the date comes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, title, scope]);

  // Opened straight on Details, the page never reads the game itself: a light
  // read names the tab when it has no title yet.
  const knownTitle = tabs.tabs.find((t) => t.id === matchId)?.title;
  useEffect(() => {
    if (view !== "details" || loaded || knownTitle) return;
    let cancelled = false;
    void listMatchesByIds([matchId]).then(([match]) => {
      if (!cancelled && match) rememberGameTab(scopeAtMount.current, { id: matchId, title: match.title, date: match.date || null });
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, view, loaded, knownTitle]);

  useEffect(() => {
    if (missing) forgetGameTab(scopeAtMount.current ?? scope, matchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, matchId]);

  const tabCount = tabs.tabs.length;
  const goTo = useCallback(
    (id: string, via: "tab" | "key" | "menu") => {
      // A switch replaces the entry: Back leaves the games, it doesn't step through them.
      navigate(`/matches/${id}`, { replace: true, state: { via: "tab" } });
      trackEvent("game_tab_switched", { via, tabs: tabCount });
    },
    [navigate, tabCount],
  );

  const close = useCallback(
    (id: string, via: "button" | "middle_click") => {
      const open = tabs.tabs.some((t) => t.id === id);
      const next = forgetGameTab(scope, id);
      trackEvent("game_tab_closed", { via, tabs: open ? tabs.tabs.length - 1 : tabs.tabs.length });
      if (id === matchId && next) navigate(`/matches/${next}`, { replace: true, state: { via: "tab" } });
    },
    [tabs, scope, matchId, navigate],
  );

  // ⌃Tab and ⌃⇧Tab step through the tabs on every layout; the Window menu's
  // ⌘⇧] and ⌘⇧[ arrive as "menu-game-tab".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.key !== "Tab") return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      e.preventDefault();
      const next = neighbourGameTab(scope, matchId, e.shiftKey ? -1 : 1);
      if (next) goTo(next, "key");
    };
    const onMenu = (e: Event) => {
      const next = neighbourGameTab(scope, matchId, (e as CustomEvent<1 | -1>).detail);
      if (next) goTo(next, "menu");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("menu-game-tab", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("menu-game-tab", onMenu);
    };
  }, [scope, matchId, goTo]);

  const tabBar =
    tabs.tabs.length >= 2 ? (
      <GameTabStrip tabs={tabs.tabs} activeId={matchId} onSelect={(id) => goTo(id, "tab")} onClose={close} />
    ) : undefined;

  const viewSwitch = <GameViewSwitch value={view ?? "game"} onChange={(next) => show(next)} />;

  // A game that isn't there is the Details view's to say (it has the empty state).
  if (view === "details" || missing) return <MatchDetailPage viewSwitch={missing ? undefined : viewSwitch} tabBar={tabBar} />;

  if (!loaded || view === null) {
    return (
      <Page>
        <Toolbar
          variant={tabBar ? "static" : "scroll"}
          tabBar={tabBar}
          title="Game"
          leading={
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => navigate("/matches")}>
              <ChevronLeft />
              Library
            </Button>
          }
        />
        <PageContent width="narrow" className={tabBar ? "pt-3" : undefined}>
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading the game…
          </div>
        </PageContent>
      </Page>
    );
  }

  return (
    <GameWatchView
      // A different game is a different visit: its own video, position and filters.
      key={loaded.match.id}
      match={loaded.match}
      videoStatus={loaded.videoStatus}
      viewSwitch={viewSwitch}
      tabBar={tabBar}
      entry={entry}
      startEventId={startEventId}
      onOpenDetails={(opts) => show("details", opts)}
    />
  );
}
