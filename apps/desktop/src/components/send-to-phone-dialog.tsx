import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Check, Copy, Loader2, RefreshCw, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendHighlightToPhone, type SendToPhoneStage } from "@/lib/highlight-share";
import { getMyShareForPlaylist } from "@/lib/highlight-shares-db";
import { highlightContentKey } from "@scoutable/shared/lib/highlight-shares-db";
import { trackEvent } from "@/lib/analytics";
import type { ExportSegment } from "@/lib/export";

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

/**
 * Renders the playlist, uploads it, and shows a QR code the user scans with
 * their phone. Reuses the playlist's existing non-expired link when there is
 * one (re-rendering is minutes of work for an unchanged video) — "Create new
 * link" forces a fresh render when the playlist has changed. Selection
 * exports always render fresh: a subset must not impersonate the full
 * playlist's link.
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [reusedFrom, setReusedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);

  function runPipeline(pl: { id: string; name: string }) {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setShareUrl(null);
    setReusedFrom(null);
    sendHighlightToPhone(pl, segments, preRoll, postRoll, setStage, vertical)
      .then((url) => {
        setShareUrl(url);
        trackEvent("highlight_sent_to_phone", {
          playlist_id: pl.id,
          clip_count: segments.filter((s) => s.kind === "clip").length,
          reused: false,
          is_selection: isSelection,
          ...(vertical ? { aspect: "9:16" } : {}),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setStage(null);
        runningRef.current = false;
      });
  }

  useEffect(() => {
    if (!open || !playlist || runningRef.current || shareUrl) return;
    // A subset (selection) must not impersonate the full playlist's link.
    if (isSelection) {
      runPipeline(playlist);
      return;
    }
    // Reuse is exact-match only: same aspect AND same content fingerprint
    // (clips, order, rolls, and — for 9:16 — crop pans). Any edit between
    // sends misses the lookup and re-renders automatically.
    const aspect = vertical ? ("9:16" as const) : ("16:9" as const);
    getMyShareForPlaylist(playlist.id, aspect, highlightContentKey(segments, preRoll, postRoll, aspect))
      .then((existing) => {
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
      .catch(() => runPipeline(playlist));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    // A render/upload in flight can't be cancelled — just don't reopen state.
    setShareUrl(null);
    setReusedFrom(null);
    setError(null);
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            Send to your phone
          </DialogTitle>
          <DialogDescription>
            {shareUrl
              ? "Scan with your phone's camera, then save or share straight from there."
              : "We'll render your highlight and give you a QR code to scan."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </p>
        ) : shareUrl ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-lg bg-white p-3">
              <QRCode value={shareUrl} size={176} />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              {reusedFrom && playlist && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => runPipeline(playlist)}
                  title="Re-render if the playlist has changed since this link was made"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Create new link
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {reusedFrom
                ? `Link created ${relativeDays(reusedFrom)} — playlist changed since? Create a new link.`
                : "The link works for 30 days — save the video to your phone right away."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {stage ? STAGE_LABEL[stage] : "Starting…"}
            </p>
            <p className="text-xs text-muted-foreground/70">
              Long playlists can take a few minutes.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
