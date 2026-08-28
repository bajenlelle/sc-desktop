import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount, mapDeleteAccountError } from "@/lib/account";
import { trackEvent } from "@/lib/analytics";

export function DeleteAccountDialog({
  email,
  trigger,
}: {
  email: string;
  trigger: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setConfirmText("");
    setError(null);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    // Fired on the confirmed request (not after) — the session is torn down
    // on success, so a post-success capture could be lost.
    trackEvent("account_delete_requested");
    const result = await deleteAccount();
    if (!result.ok) {
      setError(mapDeleteAccountError(result));
      setDeleting(false);
      return;
    }
    // The server already revoked the user — local scope avoids a 401 from
    // the server-side sign-out blocking the redirect.
    try {
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // ignore — session is dead either way
    }
    navigate("/auth/login");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete account?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This permanently deletes the account{" "}
          <span className="font-semibold text-foreground">{email}</span> — including your games,
          playlists, shared links and watch history. Any active subscription is canceled. This
          can&apos;t be undone.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleDelete}
            disabled={deleting || confirmText !== "DELETE"}
          >
            {deleting ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
