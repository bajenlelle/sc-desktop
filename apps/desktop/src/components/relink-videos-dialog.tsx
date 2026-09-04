/**
 * Bulk relink for videos that aren't on this computer — the machine-switch
 * recovery (Lightroom "Find Missing Folder" pattern): point at ONE folder,
 * every missing game whose filename is found inside gets relinked at once.
 * Matching is by filename only (matchMissingVideos); ambiguity is handed
 * back to the user as a per-row Locate instead of a guess.
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderSearch, HelpCircle, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateVideoUrl } from "@/lib/matches-db";
import { videoBasename } from "@/lib/video-probe";
import {
  matchMissingVideos,
  type RelinkMatch,
} from "@scoutable/shared/lib/video-relink";
import type { StoredMatch } from "@/types/match";

const VIDEO_FILTERS = [
  { name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] },
];

interface ScanRow {
  matchId: string;
  title: string;
  fileName: string;
  /** Path that will be linked on confirm (auto-matched or manually located). */
  resolvedPath: string | null;
  outcome: RelinkMatch["outcome"] | "located";
}

export function RelinkVideosDialog({
  missing,
  onRelinked,
}: {
  missing: StoredMatch[];
  onRelinked: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);

  async function handlePickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setScanning(true);
    try {
      const files = await invoke<{ path: string; file_name: string; size: number }[]>(
        "list_video_files",
        { dir },
      );
      const refs = missing.map((m) => ({
        matchId: m.id,
        fileName: videoBasename(m.videoUrl ?? ""),
      }));
      const titleById = new Map(missing.map((m) => [m.id, m.title]));
      const results = matchMissingVideos(
        refs,
        files.map((f) => ({ path: f.path, fileName: f.file_name })),
      );
      setRows(
        results.map((r) => ({
          matchId: r.matchId,
          title: titleById.get(r.matchId) ?? r.fileName,
          fileName: r.fileName,
          resolvedPath: r.outcome === "matched" ? r.path : null,
          outcome: r.outcome,
        })),
      );
    } catch (e) {
      toast.error("Couldn't scan that folder", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setScanning(false);
    }
  }

  async function handleLocateRow(matchId: string) {
    const file = await open({ multiple: false, filters: VIDEO_FILTERS });
    if (typeof file !== "string") return;
    setRows((prev) =>
      prev?.map((r) =>
        r.matchId === matchId ? { ...r, resolvedPath: file, outcome: "located" } : r,
      ) ?? null,
    );
  }

  const linkable = rows?.filter((r) => r.resolvedPath) ?? [];

  async function handleApply() {
    if (linkable.length === 0) return;
    setApplying(true);
    let linked = 0;
    for (const row of linkable) {
      try {
        await updateVideoUrl(row.matchId, row.resolvedPath!);
        linked++;
      } catch {
        // Leave the row for a retry; the summary toast reports the shortfall.
      }
    }
    setApplying(false);
    setDialogOpen(false);
    setRows(null);
    toast.success(
      `Linked ${linked} video${linked !== 1 ? "s" : ""}`,
      {
        description:
          "Check a clip from each game — if the timing looks off, redo the sync point.",
      },
    );
    onRelinked();
  }

  function handleOpenChange(v: boolean) {
    if (applying) return;
    setDialogOpen(v);
    if (!v) setRows(null);
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 border-amber-500/40 text-amber-600 hover:text-amber-600 dark:text-amber-400"
        >
          <VideoOff className="h-4 w-4" />
          Find missing videos… ({missing.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSearch className="h-4 w-4 text-primary" />
            Find missing videos
          </DialogTitle>
          <DialogDescription>
            Games reference the video file on the machine that imported them — nothing is
            uploaded. Point at the folder holding your game videos on this computer and
            they'll be matched by filename.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-8">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              {missing.length} game{missing.length !== 1 ? "s" : ""} point
              {missing.length === 1 ? "s" : ""} at a video that isn't on this computer.
            </p>
            <Button onClick={handlePickFolder} disabled={scanning} className="gap-2">
              <FolderSearch className="h-4 w-4" />
              {scanning ? "Scanning…" : "Choose folder…"}
            </Button>
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {rows.map((row) => (
              <div
                key={row.matchId}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.resolvedPath ?? row.fileName}
                  </p>
                </div>
                {row.resolvedPath ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    {row.outcome === "located" ? "Located" : "Found"}
                  </span>
                ) : (
                  <>
                    {row.outcome === "ambiguous" && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                        title="Several files in that folder share this name — pick the right one"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        Several matches
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => handleLocateRow(row.matchId)}
                    >
                      Locate…
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {rows !== null && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={handlePickFolder} disabled={scanning || applying}>
              Scan another folder…
            </Button>
            <Button onClick={handleApply} disabled={linkable.length === 0 || applying}>
              {applying
                ? "Linking…"
                : `Link ${linkable.length} video${linkable.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
