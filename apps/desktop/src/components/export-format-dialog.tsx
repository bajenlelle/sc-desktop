/**
 * Format step for both export actions: the dropdown stays two verbs (save /
 * send), and the aspect ratio is chosen here — picking a card proceeds
 * immediately, no extra confirm. The 9:16 card reports how many clips carry
 * a custom pan so a centered-crop surprise never ships silently.
 */
import { Monitor, RectangleVertical, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getLastExportFormat, setLastExportFormat, type ExportFormat } from "@/lib/prefs";

export type ExportAction = "save" | "send";

export function ExportFormatDialog({
  action,
  onClose,
  onPick,
  pannedClipCount,
  clipCount,
}: {
  /** Which action follows the pick; null = closed. */
  action: ExportAction | null;
  onClose: () => void;
  onPick: (format: ExportFormat) => void;
  /** Clips in the export set with a custom crop pan. */
  pannedClipCount: number;
  clipCount: number;
}) {
  const lastFormat = getLastExportFormat();

  function pick(format: ExportFormat) {
    setLastExportFormat(format);
    onPick(format);
  }

  const options: {
    format: ExportFormat;
    icon: typeof Monitor;
    title: string;
    body: string;
  }[] = [
    {
      format: "16:9",
      icon: Monitor,
      title: "Widescreen 16:9",
      body: "The full frame, as recorded — for scouting, film sessions and big screens.",
    },
    {
      format: "9:16",
      icon: RectangleVertical,
      title: "Vertical 9:16",
      body:
        clipCount > 0 && pannedClipCount < clipCount
          ? pannedClipCount === 0
            ? "For Instagram, TikTok and Shorts. No clips have a crop pan yet — everything exports center-cropped. Set pans with Vertical crop under the player."
            : `For Instagram, TikTok and Shorts. ${pannedClipCount} of ${clipCount} clips have a crop pan — the rest export center-cropped.`
          : "For Instagram, TikTok and Shorts — follows each clip's crop pan.",
    },
  ];

  return (
    <Dialog open={action !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action === "send" ? (
              <Smartphone className="size-4 text-primary" />
            ) : (
              <Monitor className="size-4 text-primary" />
            )}
            {action === "send" ? "Send to your phone" : "Save to computer"}
          </DialogTitle>
          <DialogDescription>Choose a format to continue.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.format}
              type="button"
              autoFocus={lastFormat === o.format}
              onClick={() => pick(o.format)}
              className="flex items-start gap-3 rounded-lg bg-card p-3 text-left ring-1 ring-separator outline-none transition-[background-color,box-shadow,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                <o.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {o.title}
                  {lastFormat === o.format && (
                    <span className="rounded-full bg-fill-2 px-1.5 py-px text-caption text-muted-foreground">
                      Last used
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-callout text-muted-foreground">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
