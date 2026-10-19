"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "react-qr-code";
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { SHARE_LINK_DAYS } from "@scoutable/shared/lib/game-video-wire";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fadeVariants, springs } from "@/lib/motion";
import { leftOutLines, type ExportActivity, type ShareLink } from "./use-export";

/** The desktop's QR size: big enough to scan from across a table. */
const QR_SIZE = 176;

function madeAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function worksFor(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 0) return "It expires today.";
  if (days === 1) return "It works until tomorrow.";
  return `It works for ${days} more days.`;
}

/** How long the link lasts, and for a link that came back, when it was made. */
export function linkLifeLine(link: Pick<ShareLink, "reused" | "madeDaysAgo" | "daysLeft">): string {
  if (!link.reused) return `The link works for ${SHARE_LINK_DAYS} days. Save the video to your phone before then.`;
  const made =
    link.madeDaysAgo !== null
      ? `You made this link ${madeAgo(link.madeDaysAgo)}, and its clips haven't changed since.`
      : "This link has the same clips as the playlist.";
  return [made, worksFor(link.daysLeft)].filter(Boolean).join(" ");
}

/** The finished link: its QR code, the address to copy or open, and how long it lasts. */
function LinkPanel({
  link,
  copyRef,
  onCopied,
  onCreateNew,
}: {
  link: ShareLink;
  copyRef: React.RefObject<HTMLButtonElement | null>;
  onCopied: () => void;
  onCreateNew: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      toast.error("Couldn't copy the link", { description: "Select the link and copy it from there." });
      return;
    }
    setCopied(true);
    onCopied();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  }

  const lines = leftOutLines(link.leftOut);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-lg bg-white p-3 shadow-menu">
        <QRCode value={link.url} size={QR_SIZE} title="QR code for the link" />
      </div>

      <div className="flex w-full items-center gap-2">
        <Input readOnly value={link.url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 text-callout" />
        <Button ref={copyRef} variant="outline" onClick={() => void copy()} className="w-[7.5rem]">
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <a href={link.url} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open
          </a>
        </Button>
        {link.reused && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCreateNew}>
                <RefreshCw />
                Create new link
              </Button>
            </TooltipTrigger>
            <TooltipContent>Renders the video again, for a link that lasts another {SHARE_LINK_DAYS} days</TooltipContent>
          </Tooltip>
        )}
      </div>

      <p className="text-center text-callout text-muted-foreground">{linkLifeLine(link)}</p>

      {lines.length > 0 && (
        <Callout tone="warning" icon={<AlertTriangle />} className="w-full">
          {lines.join(" ")}
        </Callout>
      )}
    </div>
  );
}

/**
 * Send to my phone's result, the desktop's send-to-phone dialog on the
 * web: the link's QR code to scan with the phone's camera, the address to
 * copy or open, and how long it lasts. A link that came back (the same
 * content was linked before) says when it was made and offers a new one;
 * while that renders, the sheet shows where it is and can be closed (the
 * export goes on, and the sheet comes back with the link) or the export
 * cancelled. On phones it is a bottom sheet.
 */
export function SendToPhoneSheet({
  open,
  link,
  working,
  onClose,
  onCreateNew,
  onCancel,
  onCopied,
}: {
  open: boolean;
  link: ShareLink | null;
  /** A link being made while the sheet is open ("Create new link"). */
  working: ExportActivity | null;
  onClose: () => void;
  onCreateNew: () => void;
  onCancel: () => void;
  onCopied: () => void;
}) {
  const copyRef = React.useRef<HTMLButtonElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const state = working ? "working" : link ? "ready" : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e) => {
          // Copy link has focus, so Return copies; the address field would select itself.
          const target = copyRef.current ?? closeRef.current;
          if (!target) return;
          e.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Smartphone className="size-4 shrink-0 text-primary" />
            Send to my phone
          </DialogTitle>
          <DialogDescription>
            {state === "working"
              ? "Making a new link from your cloud copies."
              : "Scan the code with your phone's camera, then save or share the video from there."}
          </DialogDescription>
        </DialogHeader>

        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            {state === "working" && working ? (
              <motion.div
                key="working"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex flex-col items-center gap-3 py-6"
              >
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
                <p role="status" className="text-sm text-foreground nums">
                  {working.label}
                </p>
                <ProgressBar percent={working.percent} className="w-56 max-w-full" />
                <p className="max-w-xs text-center text-callout text-muted-foreground">
                  Long playlists take a few minutes. You can close this; it comes back when the link is ready.
                </p>
              </motion.div>
            ) : link ? (
              <motion.div
                key={`link-${link.shareId}`}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springs.gentle}
              >
                <LinkPanel link={link} copyRef={copyRef} onCopied={onCopied} onCreateNew={onCreateNew} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </AutoHeight>

        <DialogFooter>
          {state === "working" && working ? (
            <>
              <Button variant="outline" disabled={!working.canCancel} onClick={onCancel}>
                {working.cancelling ? "Cancelling…" : "Cancel export"}
              </Button>
              <Button ref={closeRef} onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <Button ref={closeRef} onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
