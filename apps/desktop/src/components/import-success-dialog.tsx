/**
 * Confirms a finished import and hands the coach the next step. The import
 * used to end by silently redirecting to /playlists, which left no trace of
 * what was created — or of a missing video/sync point that would block
 * export later.
 */
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export interface ImportSummary {
  matchId: string;
  title: string;
  /** Play-by-play events — one clip each. */
  clipCount: number;
  hasVideo: boolean;
  hasSyncPoint: boolean;
  /** Re-import of a game that already existed. */
  isUpdate: boolean;
}

export function ImportSuccessDialog({
  open,
  summary,
}: {
  open: boolean;
  summary: ImportSummary | null;
}) {
  const navigate = useNavigate();
  if (!summary) return null;

  const { matchId, title, clipCount, hasVideo, hasSyncPoint, isUpdate } = summary;
  const clips = `${clipCount} clip${clipCount === 1 ? "" : "s"}`;

  // What's missing decides the primary action: without a video (or a sync
  // point) clips can't be watched or exported, so fixing that beats
  // building a playlist.
  const needs = !hasVideo ? "video" : !hasSyncPoint ? "sync" : null;

  const description = isUpdate
    ? `${title} — clips refreshed. Playlists using this game keep working.`
    : needs === "video"
      ? `${title} — ${clips} ready. Add the game video to watch clips and export them.`
      : needs === "sync"
        ? `${title} — ${clips} ready. Set a sync point so clips line up with the video.`
        : `${title} — ${clips} ready to scout.`;

  function goPlaylists() {
    navigate("/playlists", { state: { createNew: true } });
  }

  function goGame() {
    navigate(`/matches/${matchId}`);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) navigate("/playlists"); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            {isUpdate ? "Game updated" : "Game imported"}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {needs && !isUpdate ? (
            <>
              <Button variant="outline" onClick={goPlaylists}>
                Build a playlist
              </Button>
              <Button onClick={goGame}>
                {needs === "video" ? "Add video" : "Set sync point"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={goGame}>
                View game
              </Button>
              <Button onClick={goPlaylists}>Build a playlist</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
