import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This deletes <span className="font-medium text-foreground">{email}</span> with your games, playlists, shared
            links and watch history, and cancels any subscription. It can't be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor="delete-confirm" className="text-callout text-muted-foreground">
            Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
          </label>
          <Input
            id="delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {error && (
          <p role="alert" className="text-callout text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmText !== "DELETE"}>
            {deleting && <Loader2 className="animate-spin" />}
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
