"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, Download, Info, ListChecks, Smartphone } from "lucide-react";
import type { ExportAspect, ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import type { OrgPlanTier } from "@scoutable/shared/types/org";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getExportWatermarkDisabled, getLastExportFormat, setExportWatermarkDisabled, setLastExportFormat } from "@/lib/prefs";

/** What the dialog is opened for; kept while it closes, so its words don't change on the way out. */
export interface ExportDialogRequest {
  open: boolean;
  purpose: ExportPurpose;
  /** The ticked rows' keys in playlist order; null exports the whole playlist. */
  selection: string[] | null;
}

/** What the export holds, for the 9:16 card's note and the selection line. */
export interface ExportDialogCounts {
  /** Clips a 9:16 export renders, and how many of them carry a pan. */
  clips: number;
  pannedClips: number;
  /** In the selection, when there is one. */
  selectedClips: number;
  selectedCards: number;
}

/** Pro and Franchise may leave the mark off a download; Rookie always carries it, and links always do. */
function canTurnOffMark(plan: OrgPlanTier): boolean {
  return plan === "pro" || plan === "franchise";
}

/** "2 of 5 clips have no pan; they're centred." — null when every clip follows its pan. */
export function panNote(clips: number, panned: number): string | null {
  if (clips <= 0 || panned >= clips) return null;
  if (clips === 1) return "The clip has no pan; it's centred.";
  if (panned === 0) return "No clip has a pan; they're all centred.";
  const without = clips - panned;
  return `${without} of ${clips} clips ${without === 1 ? "has" : "have"} no pan; ${without === 1 ? "it's" : "they're"} centred.`;
}

/** "Exports the 3 selected clips", with the cards when the selection holds some. */
function selectionLine(clips: number, cards: number): string {
  if (clips === 0) return cards === 1 ? "Exports the selected card." : `Exports the ${cards} selected cards.`;
  const clipsPart = clips === 1 ? "the selected clip" : `the ${clips} selected clips`;
  if (cards === 0) return `Exports ${clipsPart}.`;
  return `Exports ${clipsPart} and ${cards === 1 ? "1 card" : `${cards} cards`}.`;
}

/**
 * The frame an export takes: the full widescreen picture, or the vertical
 * window cut from it (the wide frame shows faintly behind, where it comes from).
 */
function FrameGlyph({ format }: { format: ExportAspect }) {
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary pointer-coarse:size-11">
      <svg viewBox="0 0 28 28" className="size-7" fill="none" stroke="currentColor">
        {format === "16:9" ? (
          <rect x="2.75" y="7.75" width="22.5" height="12.5" rx="2" fill="currentColor" fillOpacity={0.16} strokeWidth={1.5} />
        ) : (
          <>
            <rect x="2.75" y="8.25" width="22.5" height="11.5" rx="2" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 1.75" />
            <rect x="9.25" y="2.75" width="9.5" height="22.5" rx="2" fill="currentColor" fillOpacity={0.16} strokeWidth={1.5} />
          </>
        )}
      </svg>
    </span>
  );
}

/** One format, as a row that starts the export the moment it is picked (the desktop's cards). */
function FormatCard({
  format,
  title,
  body,
  note,
  lastUsed,
  onPick,
  buttonRef,
}: {
  format: ExportAspect;
  title: string;
  body: string;
  note: string | null;
  lastUsed: boolean;
  onPick: (format: ExportAspect) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onPick(format)}
      className="group flex w-full items-start gap-3 rounded-lg bg-card p-3 text-left ring-1 ring-separator outline-none transition-[background-color,box-shadow,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:p-4"
    >
      <FrameGlyph format={format} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
          {title}
          {lastUsed && <span className="rounded-full bg-fill-2 px-1.5 py-px text-caption text-muted-foreground">Last used</span>}
        </span>
        <span className="mt-0.5 block text-callout text-muted-foreground">{body}</span>
        {note && (
          <span className="mt-1.5 flex items-start gap-1.5 text-callout text-foreground">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
            {note}
          </span>
        )}
      </span>
      <ChevronRight
        aria-hidden
        className="mt-3 size-4 shrink-0 text-muted-foreground/60 transition-transform duration-150 ease-spring group-hover:translate-x-0.5 group-active:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-active:translate-x-0"
      />
    </button>
  );
}

/** The dialog's content, mounted while it is open, so the remembered choices are read as it opens. */
function ExportChoices({
  purpose,
  plan,
  counts,
  isSelection,
  focusRef,
  onPick,
}: {
  purpose: ExportPurpose;
  plan: OrgPlanTier;
  counts: ExportDialogCounts;
  isSelection: boolean;
  focusRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (aspect: ExportAspect, watermark: boolean) => void;
}) {
  const switchId = React.useId();
  const [lastFormat] = React.useState(getLastExportFormat);
  const [watermark, setWatermark] = React.useState(() => !getExportWatermarkDisabled());
  const optional = purpose === "download" && canTurnOffMark(plan);

  const pick = (format: ExportAspect) => {
    setLastExportFormat(format);
    // The rule the server applies too: only a Pro or Franchise download may leave the mark off.
    onPick(format, optional ? watermark : true);
  };

  const focusFormat: ExportAspect = lastFormat ?? "16:9";
  const vertical = panNote(counts.clips, counts.pannedClips);

  return (
    <>
      {isSelection && (
        <p className="-mt-1 flex items-center gap-1.5 text-callout text-muted-foreground">
          <ListChecks className="size-3.5 shrink-0" aria-hidden />
          {selectionLine(counts.selectedClips, counts.selectedCards)}
        </p>
      )}

      <div role="group" aria-label="Format" className="flex flex-col gap-2">
        <FormatCard
          format="16:9"
          title="Widescreen 16:9"
          body="The full frame as recorded, for scouting, film sessions and big screens."
          note={null}
          lastUsed={lastFormat === "16:9"}
          onPick={pick}
          buttonRef={focusFormat === "16:9" ? focusRef : undefined}
        />
        <FormatCard
          format="9:16"
          title="Vertical 9:16"
          body={vertical ? "For Instagram, TikTok and Shorts." : "For Instagram, TikTok and Shorts. Follows each clip's pan."}
          note={vertical}
          lastUsed={lastFormat === "9:16"}
          onPick={pick}
          buttonRef={focusFormat === "9:16" ? focusRef : undefined}
        />
      </div>

      {optional && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-fill-1 px-3 py-2.5 pointer-coarse:py-3">
          <label htmlFor={switchId} className="min-w-0 flex-1">
            <span className="block text-sm text-foreground">Scoutable mark</span>
            <span className="block text-callout text-muted-foreground">A small logo on the video</span>
          </label>
          <Switch
            id={switchId}
            checked={watermark}
            onCheckedChange={(on) => {
              setWatermark(on);
              setExportWatermarkDisabled(!on);
            }}
          />
        </div>
      )}
      {purpose === "download" && plan === "rookie" && (
        <p className="flex items-start gap-1.5 text-callout text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          Rookie exports carry the Scoutable mark.
        </p>
      )}
    </>
  );
}

/**
 * The format step of both export actions, the desktop's export-format
 * dialog on the web: two cards, widescreen and vertical, and picking one
 * starts the export at once (the last one picked is marked and has focus,
 * so Return repeats it). The vertical card says when clips have no pan, so
 * a centred crop never ships by surprise. Downloads on Pro and Franchise
 * may leave the Scoutable mark off (remembered); Rookie is told it stays.
 * A free plan sees the same choice, and picking goes to the upgrade path.
 *
 * The dialog asks nothing of the server: what the server leaves out comes
 * with the result.
 */
export function ExportDialog({
  request,
  plan,
  counts,
  onClose,
  onPick,
}: {
  request: ExportDialogRequest | null;
  plan: OrgPlanTier;
  counts: ExportDialogCounts;
  onClose: () => void;
  onPick: (aspect: ExportAspect, watermark: boolean) => void;
}) {
  const focusRef = React.useRef<HTMLButtonElement | null>(null);
  const purpose = request?.purpose ?? "download";
  const share = purpose === "share";

  return (
    <Dialog open={!!request?.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // The last format used, else widescreen: Return repeats the usual choice.
          if (!focusRef.current) return;
          e.preventDefault();
          focusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {share ? <Smartphone className="size-4 shrink-0 text-primary" /> : <Download className="size-4 shrink-0 text-primary" />}
            {share ? "Send to my phone" : "Download video"}
          </DialogTitle>
          <DialogDescription>
            {share ? "Choose a format. You get a link and a QR code to open the video on your phone." : "Choose a format to start the export."}
          </DialogDescription>
        </DialogHeader>
        {request && (
          <ExportChoices
            purpose={purpose}
            plan={plan}
            counts={counts}
            isSelection={request.selection !== null}
            focusRef={focusRef}
            onPick={onPick}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
