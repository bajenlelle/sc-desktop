import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Check, Copy, Loader2, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendHighlightToPhone, type SendToPhoneStage } from "@/lib/highlight-share";
import { trackEvent } from "@/lib/analytics";
import type { ExportSegment } from "@/lib/export";

const STAGE_LABEL: Record<SendToPhoneStage, string> = {
  rendering: "Rendering your highlight…",
  uploading: "Uploading…",
  saving: "Creating your link…",
};

/**
 * Renders the playlist, uploads it, and shows a QR code the user scans with
 * their phone. The phone lands on the public /h/{id} page, where the native
 * share sheet takes over (camera roll, Instagram, TikTok, …).
 */
export function SendToPhoneDialog({
  open,
  onClose,
  playlist,
  segments,
  preRoll,
  postRoll,
}: {
  open: boolean;
  onClose: () => void;
  playlist: { id: string; name: string } | null;
  segments: ExportSegment[];
  preRoll: number;
  postRoll: number;
}) {
  const [stage, setStage] = useState<SendToPhoneStage | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!open || !playlist || runningRef.current || shareUrl) return;
    runningRef.current = true;
    setError(null);
    sendHighlightToPhone(playlist, segments, preRoll, postRoll, setStage)
      .then((url) => {
        setShareUrl(url);
        trackEvent("highlight_sent_to_phone", {
          playlist_id: playlist.id,
          clip_count: segments.filter((s) => s.kind === "clip").length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setStage(null);
        runningRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleClose() {
    // A render/upload in flight can't be cancelled — just don't reopen state.
    setShareUrl(null);
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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              The link works for 30 days — save the video to your phone right away.
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
