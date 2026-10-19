"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import { openUpgradeFlow } from "@/lib/billing";

const DEFAULT_BODY =
  "Turn your playlists into MP4s you can share anywhere, with 6 game imports a month on Rookie and unlimited on Pro. Cancel anytime.";

/**
 * A paid feature's gate, the web twin of the desktop's
 * components/upgrade-dialog.tsx: what was asked for, what the plans add,
 * and the way there. "See plans" goes through openUpgradeFlow (the pricing
 * page for a new subscriber, the billing portal for an existing one) and
 * starts the plan poll, so the feature opens once the webhook lands.
 */
export function UpgradeDialog({
  open,
  onClose,
  title,
  description = DEFAULT_BODY,
  feature,
  source,
}: {
  open: boolean;
  onClose: () => void;
  /** What the user tried, as a heading: "Download your playlist as a video". */
  title: string;
  description?: string;
  /** Stable name for `upgrade_gate_hit`, the desktop's vocabulary ("export_playlist_vertical"). */
  feature: string;
  /** Where the upgrade started, for `upgrade_clicked`. */
  source: string;
}) {
  const { user, profile, expectPlanChange } = useAuth();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) trackEvent("upgrade_gate_hit", { feature, origin: "web" });
  }, [open, feature]);

  async function upgrade() {
    setLoading(true);
    try {
      const error = await openUpgradeFlow(profile?.email ?? user?.email, source);
      if (error) {
        toast.error(error);
        return;
      }
      expectPlanChange();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !loading && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <div className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/12 text-primary">
            <Lock className="size-5" />
          </span>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Not now
          </Button>
          <Button onClick={() => void upgrade()} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            See plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
