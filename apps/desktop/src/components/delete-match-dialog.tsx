import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteMatch } from "@/lib/matches-db";
import { useImportQuota } from "@/lib/use-import-quota";

export function DeleteMatchDialog({
  matchId,
  matchTitle,
  trigger,
  onDeleted,
  isDemo,
}: {
  matchId: string;
  matchTitle: string;
  trigger: React.ReactNode;
  onDeleted: () => void;
  /** The sample game never counted against the quota, so no note for it. */
  isDemo?: boolean;
}) {
  // null = unlimited tier or team space, where the quota note is noise.
  const importQuota = useImportQuota();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMatch(matchId);
      setOpen(false);
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete game.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{matchTitle}”?</DialogTitle>
          <DialogDescription>The game and all its clips are removed for good. This can't be undone.</DialogDescription>
        </DialogHeader>
        {!isDemo && importQuota !== null && (
          <p className="text-callout text-muted-foreground">
            {importQuota.window === "lifetime"
              ? `Deleting doesn't give back a free import: the free plan has ${importQuota.baseLimit} in total. Importing this same game again later is free.`
              : "Deleting doesn't give back this month's import. Importing this same game again later is free."}
          </p>
        )}
        {deleteError && (
          <p role="alert" className="text-callout text-destructive">
            {deleteError}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />}
            Delete game
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
