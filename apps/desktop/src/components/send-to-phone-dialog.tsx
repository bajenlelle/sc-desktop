import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "react-qr-code";
import { Check, Copy, Loader2, RefreshCw, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sendHighlightToPhone, type SendToPhoneStage } from "@/lib/highlight-share";
import { getMyShareForPlaylist } from "@/lib/highlight-shares-db";
import { highlightContentKey } from "@scoutable/shared/lib/highlight-shares-db";
import {
  exportProgressLabel,
  exportProgressPercent,
  type ExportProgress,
} from "@scoutable/shared/lib/export-progress";
import { trackEvent } from "@/lib/analytics";
import { dropClipsOutsideVideos, type ExportSegment } from "@/lib/export";
import { fadeVariants, springs } from "@/lib/motion";

const APP_URL = "https://app.scoutable.se";

const STAGE_LABEL: Record<SendToPhoneStage, string> = {
  rendering: "Rendering your highlight…",
  uploading: "Uploading…",
  saving: "Creating your link…",
};

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Renders the playlist, uploads it, and shows a QR code the user scans with
 * their phone. Reuses the playlist's existing non-expired link when there is
 * one (re-rendering is minutes of work for an unchanged video) — "Create new
 * link" forces a fresh render when the playlist has changed. Selection
 * exports always render fresh: a subset must not impersonate the full
 * playlist's link.
 *
 * Every way out cancels: closing stops the render (ffmpeg is killed) or the
 * upload, and nothing is linked.
 */
export function SendToPhoneDialog({
  open,
  onClose,
  playlist,
  segments,
  preRoll,
  postRoll,
  isSelection,
  vertical = false,
}: {
  open: boolean;
  onClose: () => void;
  playlist: { id: string; name: string } | null;
  segments: ExportSegment[];
  preRoll: number;
  postRoll: number;
  isSelection: boolean;
  /** Render 9:16 instead of 16:9. Always renders fresh — stored links point at 16:9 masters. */
  vertical?: boolean;
}) {
  const [stage, setStage] = useState<SendToPhoneStage | null>(null);
  const [renderProgress, setRenderProgress] = useState<ExportProgress | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [reusedFrom, setReusedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Clips outside a partial recording are dropped, not fatal — this note
  // tells the sender what the rendered video won't contain.
  const [rangeNote, setRangeNote] = useState<string | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Bumped by every run and every close: a run that was left behind never touches the state again. */
  const runIdRef = useRef(0);
  // What actually renders: segments minus out-of-range clips. Everything
  // downstream (render, analytics, the reuse fingerprint) must read this,
  // never the raw prop, or the cached link stops matching its content.
  const keptRef = useRef<ExportSegment[]>(segments);

  function runPipeline(pl: { id: string; name: string }) {
    if (runningRef.current) return;
    runningRef.current = true;
    const run = ++runIdRef.current;
    const current = () => run === runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setShareUrl(null);
    setReusedFrom(null);
    setRenderProgress(null);
    const kept = keptRef.current;
    sendHighlightToPhone(pl, kept, preRoll, postRoll, setStage, vertical, setRenderProgress, controller.signal)
      .then((url) => {
        if (controller.signal.aborted || !current()) return;
        setShareUrl(url);
        trackEvent("highlight_sent_to_phone", {
          playlist_id: pl.id,
          clip_count: kept.filter((s) => s.kind === "clip").length,
          stats_cards: kept.filter((s) => s.kind === "text" && s.card).length,
          reused: false,
          is_selection: isSelection,
          ...(vertical ? { aspect: "9:16" } : {}),
        });
      })
      .catch((e) => {
        if (isAbort(e) || controller.signal.aborted || !current()) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        if (!current()) return;
        setStage(null);
        setRenderProgress(null);
        runningRef.current = false;
      });
  }

  useEffect(() => {
    if (!open || !playlist || runningRef.current || shareUrl) return;
    let cancelled = false;
    (async () => {
      // Partial recordings (first half only) are legitimate: render what the
      // video covers, surface what it can't. Zero coverage = wrong file.
      const { kept, skipped, note } = await dropClipsOutsideVideos(segments, preRoll, postRoll);
      if (cancelled) return;
      if (!kept.some((s) => s.kind === "clip")) {
        setError(
          "None of these clips fall inside the linked video — it may be the wrong file, " +
            "or its sync point may be off. Open the game in the Library to relink or re-sync.",
        );
        return;
      }
      keptRef.current = kept;
      setRangeNote(skipped > 0 ? note : null);

      // A subset (selection) must not impersonate the full playlist's link.
      if (isSelection) {
        runPipeline(playlist);
        return;
      }
      // Reuse is exact-match only: same aspect AND same content fingerprint
      // (clips, order, rolls, and — for 9:16 — crop pans). Any edit between
      // sends misses the lookup and re-renders automatically. Fingerprint the
      // KEPT set: relinking the full recording changes it → fresh render
      // instead of reusing a partial master.
      const aspect = vertical ? ("9:16" as const) : ("16:9" as const);
      getMyShareForPlaylist(playlist.id, aspect, highlightContentKey(kept, preRoll, postRoll, aspect))
        .then((existing) => {
          if (cancelled) return;
          if (existing) {
            setShareUrl(`${APP_URL}/h/${existing.id}`);
            setReusedFrom(existing.createdAt);
            trackEvent("highlight_sent_to_phone", {
              playlist_id: playlist.id,
              reused: true,
              ...(vertical ? { aspect: "9:16" } : {}),
            });
          } else {
            runPipeline(playlist);
          }
        })
        .catch(() => {
          if (!cancelled) runPipeline(playlist);
        });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    // Leave the stopped run behind, so reopening starts a fresh one at once.
    runIdRef.current++;
    runningRef.current = false;
    setStage(null);
    setRenderProgress(null);
    setShareUrl(null);
    setReusedFrom(null);
    setError(null);
    setRangeNote(null);
    setCopied(false);
    onClose();
  }

  function handleCopy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const phase = error ? "error" : shareUrl ? "done" : "working";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4 text-primary" />
            Send to your phone
          </DialogTitle>
          <DialogDescription>
            {phase === "done"
              ? "Scan with your phone's camera, then save or share straight from there."
              : "We'll render your highlight and give you a QR code to scan."}
          </DialogDescription>
        </DialogHeader>

        <AutoHeight>
          {!error && rangeNote && (
            <p className="mb-3 rounded-window bg-warning/12 px-3 py-2 text-callout text-foreground">
              {rangeNote}
            </p>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            {phase === "error" ? (
              <motion.p
                key="error"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </motion.p>
            ) : phase === "done" ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springs.gentle}
                className="flex flex-col items-center gap-4 py-2"
              >
                <div className="rounded-lg bg-white p-3 shadow-menu">
                  <QRCode value={shareUrl!} size={176} />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  {reusedFrom && playlist && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => runPipeline(playlist)}>
                          <RefreshCw />
                          Create new link
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Renders again, for when the playlist changed after this link was made</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <p className="text-center text-callout text-muted-foreground">
                  {reusedFrom
                    ? `Link created ${relativeDays(reusedFrom)} — playlist changed since? Create a new link.`
                    : "The link works for 30 days — save the video to your phone right away."}
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="working"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex flex-col items-center gap-3 py-6"
              >
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-foreground">{stage ? STAGE_LABEL[stage] : "Starting…"}</p>
                <div className="flex h-9 w-56 flex-col items-center gap-1.5">
                  {stage === "rendering" && renderProgress && (
                    <>
                      <ProgressBar percent={exportProgressPercent(renderProgress)} className="w-full" />
                      <p className="text-callout text-muted-foreground nums">{exportProgressLabel(renderProgress)}</p>
                    </>
                  )}
                  {stage !== "rendering" && (
                    <p className="text-callout text-muted-foreground">Long playlists can take a few minutes.</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </AutoHeight>

        <DialogFooter>
          <Button variant={phase === "working" ? "outline" : "default"} onClick={handleClose}>
            {phase === "working" ? "Cancel" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
