"use client";

/**
 * Client half of the public highlight page. The server component fetches the
 * share (so unfurl bots see real metadata); this component owns the one thing
 * that must be client-side: the Web Share API button. On mobile browsers that
 * support file sharing (iOS Safari 15+, Android Chrome) it hands the actual
 * MP4 to the native share sheet — Save Video, Instagram, TikTok — so the
 * player never touches a file manager. Desktop browsers fall back to a
 * plain download.
 */
import { useEffect, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

export type HighlightShareResult =
  | { valid: true; title: string; url: string; posterUrl: string | null }
  | { valid: false; reason: "not_found" | "expired" };

export default function HighlightView({ share }: { share: HighlightShareResult }) {
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    trackEvent("highlight_page_viewed", { valid: share.valid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleShare() {
    if (!share.valid) return;
    setSharing(true);
    try {
      const resp = await fetch(share.url);
      const blob = await resp.blob();
      const file = new File([blob], `${share.title.replace(/[^a-z0-9]/gi, "_")}.mp4`, {
        type: "video/mp4",
      });
      if (navigator.canShare?.({ files: [file] })) {
        // Empty text on purpose — iOS Safari drops the file when text is set.
        await navigator.share({ files: [file], title: share.title });
        // A dismissed share sheet throws, so reaching here means it succeeded.
        trackEvent("highlight_saved", { method: "native_share" });
        return;
      }
      // No file-share support (desktop browsers): download instead.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
      trackEvent("highlight_saved", { method: "download" });
    } catch {
      // Share sheet dismissed or fetch failed — nothing to clean up.
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center gap-6 px-4 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(1.5rem+var(--safe-bottom))]">
      <LogoMark className="size-10 rounded-[9px] shadow-sm ring-1 ring-black/5" />

      {!share.valid ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
          <p className="text-title-3 text-foreground">
            {share.reason === "expired" ? "This highlight has expired" : "Highlight not found"}
          </p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {share.reason === "expired"
              ? "Share links work for 30 days. Ask for a fresh one from the Scoutable app."
              : "Check that you scanned or copied the full link."}
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-center text-title-2 text-foreground">{share.title}</h1>

          {/* The browser's own controls on purpose: they bring saving,
              AirPlay and picture in picture. playsInline keeps iOS from
              jumping to full screen on tap. No forced aspect ratio: masters
              are 16:9 or 9:16 (vertical export) and the element sizes to
              whichever it gets; max-h keeps a portrait video from pushing
              the buttons off screen. */}
          <video
            src={share.url}
            poster={share.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-[70dvh] w-full rounded-window bg-black object-contain ring-1 ring-separator"
          />

          <Button size="lg" className="w-full" onClick={handleShare} disabled={sharing}>
            {sharing ? <Loader2 className="animate-spin" /> : <Share2 />}
            {sharing ? "Preparing…" : "Save or share"}
          </Button>
          <p className="flex items-center gap-1.5 text-center text-callout text-muted-foreground">
            <Download className="size-3.5 shrink-0" aria-hidden />
            Saves to your camera roll, or shares straight to Instagram, TikTok and more.
          </p>
        </>
      )}

      <a
        href="https://scoutable.se"
        target="_blank"
        rel="noreferrer"
        className="mt-auto pt-6 text-callout text-muted-foreground underline-offset-2 hover:underline"
      >
        Made with Scoutable
      </a>
    </div>
  );
}
