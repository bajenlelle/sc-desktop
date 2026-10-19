"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setGameVideoSync } from "@scoutable/shared/lib/game-video-client";
import type { GameVideoPlayResponse } from "@scoutable/shared/lib/game-video-wire";
import { getMatch } from "@scoutable/shared/lib/matches-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { ConvertFailedCard } from "@/components/game/convert-failed-card";
import { ConvertingCard } from "@/components/game/converting-card";
import { GameSyncSetup } from "@/components/game/game-sync-setup";
import { GameWatchView } from "@/components/game/game-watch-view";
import { TipoffCheckBanner } from "@/components/game/tipoff-check-banner";
import { UploadCard, UploadInterruptedCard } from "@/components/game/upload-card";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import { formatGameDate, formatGameLength } from "@/lib/format-game";
import { startGameUpload, useGameUploadJob } from "@/lib/game-upload";
import { fetchPlayUrl, useGameVideoRow } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";

type Loaded = { matchId: string; match: StoredMatch | null; owner: boolean };

/**
 * A game's page: its cloud video in whatever state it is in. Uploading
 * (from this device, with progress; or interrupted, asking for the file
 * again), converting, failed, or ready: then the whole game with the
 * play-by-play beside it once it has a sync, and the tip-off picker until
 * it does. Only the person who uploaded the video gets a URL for it;
 * everyone else sees the same "isn't available" whether the game exists
 * or not.
 */
export default function GamePage() {
  const { matchId } = useParams<{ matchId: string }>();
  const searchParams = useSearchParams();
  const { user, profileLoading } = useAuth();
  const startAt = useMemo(() => {
    const t = Number(searchParams.get("t"));
    return Number.isFinite(t) && t > 0 ? t : null;
  }, [searchParams]);
  const from = searchParams.get("from");

  // Keyed by game, so a navigation to another game reads as loading at once.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [matchVersion, setMatchVersion] = useState(0);
  useEffect(() => {
    if (profileLoading || !user) return;
    let cancelled = false;
    const supabase = createClient();
    void Promise.all([getMatch(supabase, matchId), supabase.from("matches").select("user_id").eq("id", matchId).maybeSingle()]).then(
      ([match, ownerRow]) => {
        if (cancelled) return;
        setLoaded({ matchId, match, owner: (ownerRow.data as { user_id?: string } | null)?.user_id === user.id });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [matchId, matchVersion, profileLoading, user]);
  const reloadMatch = useCallback(() => setMatchVersion((v) => v + 1), []);
  const state = loaded?.matchId === matchId ? loaded : null;
  const match = state?.match ?? null;

  const { video, loaded: videoLoaded, reload: reloadVideo } = useGameVideoRow(matchId, { enabled: !profileLoading && !!user });
  const job = useGameUploadJob(matchId);

  // The play URL, once the copy is ready; a fresh one when it has run out (they live 12 hours).
  const [play, setPlay] = useState<{ videoId: string; play: GameVideoPlayResponse | null } | null>(null);
  const readyId = video?.status === "ready" ? video.id : null;
  useEffect(() => {
    if (!readyId) return;
    let cancelled = false;
    void fetchPlayUrl(matchId).then((p) => {
      if (!cancelled) setPlay({ videoId: readyId, play: p });
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, readyId]);
  const refreshUrl = useCallback(() => fetchPlayUrl(matchId, { force: true }).then((r) => r?.url ?? null), [matchId]);

  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match || video?.status !== "ready" || openedRef.current === matchId) return;
    openedRef.current = matchId;
    // `from`: the Library ("library"; "games" from links made before the rename), Home, a clip, or a link.
    const known = from === "library" || from === "games" || from === "home" || from === "clip";
    trackEvent("game_opened", { match_id: matchId, from: known ? from : "link" });
    // `from` only labels the first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, video?.status, matchId]);

  const [checking, setChecking] = useState(false);
  const [resuming, setResuming] = useState(false);
  const checkContainer = useRef<HTMLDivElement | null>(null);

  const back = <BackButton href="/library" label="Library" />;
  const subtitle = (duration: number | null) => [formatGameDate(match?.date), formatGameLength(duration)].filter(Boolean).join(" · ");

  if (!state || !videoLoaded) {
    return (
      <Page width="full">
        <Toolbar inline title="" leading={back} />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }

  if (!match || (!video && !state.owner)) {
    return (
      <Page width="medium">
        <Toolbar inline title="Game" leading={back} />
        <StatusScreen
          icon={<Clapperboard />}
          title="This game isn't available"
          body="Only the person who keeps a game in the cloud can watch it here."
          actions={
            <Button asChild variant="outline">
              <Link href="/library">Library</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  // The owner's game without a video yet: the upload starts from here.
  if (!video) {
    return (
      <Page width="medium">
        <Toolbar inline title={match.title} subtitle={subtitle(null)} leading={back} />
        <StatusScreen
          icon={<Clapperboard />}
          title="No video for this game yet"
          body="Upload the game's video and it plays here with every play lined up."
          actions={
            <Button asChild>
              <ImportEntryLink placement="game_page" matchId={match.id}>
                Upload the video
              </ImportEntryLink>
            </Button>
          }
        />
      </Page>
    );
  }

  if (video.status !== "ready") {
    return (
      <Page width="medium">
        <Toolbar inline title={match.title} subtitle={subtitle(null)} leading={back} />
        <PageContent>
          {video.status === "uploading" && job && job.phase !== "checking" ? (
            <UploadCard job={job} />
          ) : video.status === "uploading" ? (
            <UploadInterruptedCard
              video={video}
              busy={resuming || job?.phase === "checking"}
              onFile={(file) => {
                setResuming(true);
                void startGameUpload({
                  matchId: match.id,
                  title: match.title,
                  file,
                  anchor: {
                    kind: video.anchorKind ?? "tipoff",
                    label: video.anchorLabel ?? "the tip-off",
                    realWorldTime: video.anchorRealWorldTime,
                  },
                  expectResume: true,
                }).finally(() => setResuming(false));
              }}
            />
          ) : video.status === "converting" ? (
            <ConvertingCard video={video} />
          ) : (
            <ConvertFailedCard video={video} onChanged={() => void reloadVideo()} />
          )}
        </PageContent>
      </Page>
    );
  }

  const current = play?.videoId === video.id ? play.play : undefined;
  if (current === undefined) {
    return (
      <Page width="full">
        <Toolbar inline title={match.title} subtitle={subtitle(video.durationSeconds)} leading={back} />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }
  if (current === null) {
    return (
      <Page width="medium">
        <Toolbar inline title={match.title} leading={back} />
        <StatusScreen
          icon={<Clapperboard />}
          title="This game isn't available"
          body="The video couldn't be opened. Try again in a moment."
          actions={
            <Button variant="outline" onClick={() => void reloadVideo()}>
              Try again
            </Button>
          }
        />
      </Page>
    );
  }

  const syncSeconds = typeof match.syncPoint?.syncVideoTime === "number" ? match.syncPoint.syncVideoTime : null;
  const afterSync = () => {
    setChecking(false);
    reloadMatch();
    void reloadVideo();
  };

  // Ready, no sync yet: the picker takes the watch view's place.
  if (syncSeconds === null) {
    return (
      <Page width="medium">
        <Toolbar inline title={match.title} subtitle={subtitle(current.durationSeconds)} leading={back} />
        <PageContent>
          <GameSyncSetup key={video.id} match={match} video={video} src={current.url} onSourceStale={refreshUrl} mode="setup" onSynced={afterSync} />
        </PageContent>
      </Page>
    );
  }

  return (
    <Page width="full">
      <Toolbar inline title={match.title} subtitle={subtitle(current.durationSeconds)} leading={back} />
      {video.syncStatus === "applied" && (
        <TipoffCheckBanner
          video={video}
          seconds={syncSeconds}
          onCheck={() => setChecking(true)}
          onLooksRight={async () => {
            const result = await setGameVideoSync(createClient(), { videoId: video.id, status: "confirmed" });
            if (!result.ok) {
              if (result.error === "sync_locked") afterSync();
              else toast.error("Couldn't confirm the tip-off", { description: "Try again in a moment." });
              return;
            }
            trackEvent("tipoff_check_resolved", { action: "looks_right", delta_s: 0, mode: "banner" });
            afterSync();
          }}
        />
      )}
      <GameWatchView key={match.id} match={match} src={current.url} startAt={startAt} onSourceStale={refreshUrl} />

      <Dialog open={checking} onOpenChange={setChecking}>
        <DialogContent className="sm:max-w-3xl" showCloseButton>
          <div ref={checkContainer} className="pt-2">
            <DialogTitle className="sr-only">Check the tip-off</DialogTitle>
            {checking && (
              <GameSyncSetup
                match={match}
                video={video}
                src={current.url}
                onSourceStale={refreshUrl}
                mode="check"
                appliedSeconds={syncSeconds}
                onSynced={afterSync}
                keyContainer={checkContainer}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
