/**
 * Confirms a finished import and hands the coach the next step. The import
 * used to end by silently redirecting to /playlists, which left no trace of
 * what was created — or of a missing video/sync point that would block
 * export later. Every way out animates the dialog away first and only then
 * changes the page underneath it.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { springs } from "@/lib/motion";

export interface ImportSummary {
  matchId: string;
  title: string;
  /** Play-by-play events — one clip each. */
  clipCount: number;
  hasVideo: boolean;
  hasSyncPoint: boolean;
  /** The video looks like it skips the breaks, and its quarters aren't synced yet. */
  needsQuarters?: boolean;
  /** Re-import of a game that already existed. */
  isUpdate: boolean;
}

export function ImportSuccessDialog({
  open: openProp,
  summary,
}: {
  open: boolean;
  summary: ImportSummary | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(openProp);
  const next = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (openProp) setOpen(true);
  }, [openProp]);

  if (!summary) return null;

  const { matchId, title, clipCount, hasVideo, hasSyncPoint, needsQuarters, isUpdate } = summary;
  const clips = `${clipCount} clip${clipCount === 1 ? "" : "s"}`;

  // What's missing decides the primary action: without a video (or a sync
  // point) clips can't be watched or exported, so fixing that beats
  // building a playlist.
  const needs = !hasVideo ? "video" : !hasSyncPoint ? "sync" : needsQuarters ? "quarters" : null;

  const description = isUpdate
    ? `${title} — clips refreshed. Playlists using this game keep working.`
    : needs === "video"
      ? `${title} — ${clips} ready. Add the game video to watch clips and export them.`
      : needs === "sync"
        ? `${title} — ${clips} ready. Set a sync point so clips line up with the video.`
        : needs === "quarters"
          ? `${title} — ${clips} ready. The video looks cut between quarters: set where each quarter starts so later clips line up.`
        : `${title} — ${clips} ready to scout.`;

  /** Leave the same way the dialog came, then go. */
  function closeThen(go: () => void) {
    next.current = go;
    setOpen(false);
  }

  const goPlaylists = () => closeThen(() => navigate("/playlists", { state: { createNew: true } }));
  const goGame = () => closeThen(() => navigate(`/matches/${matchId}`));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeThen(() => navigate("/playlists")); }}>
      <DialogContent
        onExitComplete={() => {
          const go = next.current;
          next.current = null;
          go?.();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...springs.settle, delay: 0.08 }}
              className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <Check className="size-3" strokeWidth={3} />
            </motion.span>
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
                {needs === "video" ? "Add video" : needs === "quarters" ? "Set quarters" : "Set sync point"}
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
