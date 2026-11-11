import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { GameViewSwitch, type GameViewMode } from "@/components/game/game-view-switch";
import { GameWatchView } from "@/components/game/game-watch-view";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { getMatch } from "@/lib/matches-db";
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
 * entered, so a sync, a video or a title changed in Details is what it shows.
 */
export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const asked = searchParams.get("view");
  const wantsQuarters = !!(location.state as { openQuarters?: boolean } | null)?.openQuarters;
  const startEventId = Number(searchParams.get("play")) || null;
  const [view, setView] = useState<GameViewMode | null>(asked === "details" || wantsQuarters ? "details" : asked === "game" || startEventId ? "game" : null);
  const [entry] = useState(asked || startEventId ? "link" : "library");
  const [loaded, setLoaded] = useState<{ match: StoredMatch; videoStatus: VideoFileStatus | "none" } | null>(null);
  const [missing, setMissing] = useState(false);

  // The game and whether its video plays here: read on arrival (to choose the
  // view) and again whenever the coach comes back from Details.
  useEffect(() => {
    if (view === "details") return;
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

  const viewSwitch = <GameViewSwitch value={view ?? "game"} onChange={(next) => show(next)} />;

  // A game that isn't there is the Details view's to say (it has the empty state).
  if (view === "details" || missing) return <MatchDetailPage viewSwitch={missing ? undefined : viewSwitch} />;

  if (!loaded || view === null) {
    return (
      <Page>
        <Toolbar
          title="Game"
          leading={
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => navigate("/matches")}>
              <ChevronLeft />
              Library
            </Button>
          }
        />
        <PageContent width="narrow">
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
      entry={entry}
      startEventId={startEventId}
      onOpenDetails={(opts) => show("details", opts)}
    />
  );
}
