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
    ? `${title}: clips refreshed. Playlists using this game keep working. Play a clip to check the timing.`
    : needs === "video"
      ? `${title}: ${clips} ready. Add the game video to watch clips and export them.`
      : needs === "sync"
        ? `${title}: ${clips} ready. Set the tip-off so clips line up with the video.`
        : needs === "quarters"
          ? `${title}: ${clips} ready. The video looks cut between quarters, so set where each quarter starts and later clips line up.`
          : `${title}: ${clips} ready to scout. Play a clip to check the timing. If a play is at the wrong moment, Fix sync moves it.`;

  /** Leave the same way the dialog came, then go. */
  function closeThen(go: () => void) {
    next.current = go;
    setOpen(false);
  }

  const goPlaylists = () => closeThen(() => navigate("/playlists", { state: { createNew: true } }));
  // "Set quarters" (the primary on a fresh import) lands with the picker already open on the first unset quarter.
  const goGame = () =>
    closeThen(() => navigate(`/matches/${matchId}`, needs === "quarters" && !isUpdate ? { state: { openQuarters: true } } : undefined));

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
                {needs === "video" ? "Add video" : needs === "quarters" ? "Set quarters" : "Set tip-off"}
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
