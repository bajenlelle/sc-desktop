"use client";

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
import { Input } from "@/components/ui/input";
import { signOutAndLeave } from "@/lib/sign-out";
import { trackEvent } from "@/lib/analytics";

function mapDeleteAccountError(status: number, body: { error?: string; orgName?: string }): string {
  if (status === 401) return "Your session expired. Sign in again and retry.";
  if (body.error === "last_admin") {
    return `You're the only admin of ${body.orgName ?? "your club"}. Promote another admin or remove its members first.`;
  }
  return "Couldn't delete your account. Try again, or contact support.";
}

export function DeleteAccountDialog({
  email,
  trigger,
}: {
  email: string;
  trigger: React.ReactNode;
}) {
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
    // Before the call, not after — a successful deletion tears the session
    // down and the event would never leave the page.
    trackEvent("account_delete_requested");
    let leaving = false;
    try {
      const res = await fetch("/api/delete-account", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(mapDeleteAccountError(res.status, body));
        return;
      }
      // The server already revoked the user; the page goes now, and the
      // button stays busy until it has.
      leaving = true;
      await signOutAndLeave();
    } catch {
      setError("Couldn't delete your account. Check your connection and try again.");
    } finally {
      if (!leaving) setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This deletes <span className="font-medium text-foreground">{email}</span> with your games, playlists, shared
            links and watch history, and cancels any subscription. It can&apos;t be undone.
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
