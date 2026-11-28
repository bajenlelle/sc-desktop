import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ReportListStatus } from "@scoutable/shared/lib/scouting-report-list";

/**
 * Delete report? It can't be undone: the link stops working. A report that owns its clips takes them
 * with it (the plays stay in their games); one made on a playlist leaves that playlist as it is.
 */
export function DeleteReportDialog({
  target,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: { title: string; playlistName: string; ownClips: boolean; status: ReportListStatus } | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const live = target?.status === "live";
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !deleting && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{target?.title}”?</DialogTitle>
          <DialogDescription>
            {[
              live ? "Its link stops working right away." : null,
              target?.ownClips ? "Its clips go with it. The plays stay in their games." : `The playlist “${target?.playlistName}” stays as it is.`,
              "This can’t be undone.",
            ]
              .filter(Boolean)
              .join(" ")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={deleting} onClick={onCancel}>
            Keep report
          </Button>
          <Button variant="destructive" size="sm" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : "Delete report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
