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
import { Check, FolderSearch, HelpCircle, Loader2, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { Callout, GroupedList } from "@/components/ui/group";
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
          "Check a clip from each game. If the timing looks off, set the tip-off again.",
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
        <Button variant="outline" size="sm" className="text-warning hover:text-warning">
          <VideoOff />
          Find missing videos… <span className="nums">({missing.length})</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find missing videos</DialogTitle>
          <DialogDescription>
            Games use the video file on the computer that imported them; nothing is uploaded. Choose the folder that
            holds your game videos on this computer and they're matched by file name.
          </DialogDescription>
        </DialogHeader>

        <AutoHeight>
          {rows === null ? (
            <Callout
              tone="warning"
              icon={<VideoOff />}
              action={
                <Button size="sm" onClick={handlePickFolder} disabled={scanning}>
                  {scanning ? <Loader2 className="animate-spin" /> : <FolderSearch />}
                  Choose folder…
                </Button>
              }
            >
              {missing.length === 1
                ? "1 game points at a video file that can't be found."
                : `${missing.length} games point at video files that can't be found.`}
            </Callout>
          ) : (
            <GroupedList className="max-h-72 overflow-y-auto">
              {rows.map((row) => (
                <div key={row.matchId} className="flex min-h-12 items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{row.title}</p>
                    <p className="truncate text-callout text-muted-foreground">{row.resolvedPath ?? row.fileName}</p>
                  </div>
                  {row.resolvedPath ? (
                    <span className="flex shrink-0 items-center gap-1 text-callout text-success">
                      <Check className="size-3.5" />
                      {row.outcome === "located" ? "Located" : "Found"}
                    </span>
                  ) : (
                    <>
                      {row.outcome === "ambiguous" && (
                        <span className="flex shrink-0 items-center gap-1 text-callout text-muted-foreground">
                          <HelpCircle className="size-3.5" />
                          Several files match
                        </span>
                      )}
                      <Button size="xs" variant="outline" className="shrink-0" onClick={() => handleLocateRow(row.matchId)}>
                        Locate…
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </GroupedList>
          )}
        </AutoHeight>

        {rows !== null && (
          <DialogFooter className="items-center sm:justify-between">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={handlePickFolder} disabled={scanning || applying}>
              Scan another folder…
            </Button>
            <Button onClick={handleApply} disabled={linkable.length === 0 || applying}>
              {applying && <Loader2 className="animate-spin" />}
              Link {linkable.length} video{linkable.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
