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
import { useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { LogoMark } from "@/components/logo";

export type HighlightShareResult =
  | { valid: true; title: string; url: string }
  | { valid: false; reason: "not_found" | "expired" };

export default function HighlightView({ share }: { share: HighlightShareResult }) {
  const [sharing, setSharing] = useState(false);

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
        return;
      }
      // No file-share support (desktop browsers): download instead.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      // Share sheet dismissed or fetch failed — nothing to clean up.
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center gap-6 px-4 py-10">
      <LogoMark className="h-10 w-10 rounded-lg" />

      {!share.valid ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-base font-semibold text-foreground">
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
          <h1 className="text-center text-lg font-semibold text-foreground">{share.title}</h1>

          {/* playsInline keeps iOS from hijacking into fullscreen on tap */}
          <video
            src={share.url}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-xl border border-border bg-black"
          />

          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {sharing ? "Preparing…" : "Save / Share"}
          </button>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Download className="h-3 w-3" aria-hidden />
            Saves to your camera roll or shares straight to Instagram, TikTok and more.
          </p>
        </>
      )}

      <a
        href="https://scoutable.se"
        target="_blank"
        rel="noreferrer"
        className="mt-auto pt-6 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Made with Scoutable
      </a>
    </div>
  );
}
