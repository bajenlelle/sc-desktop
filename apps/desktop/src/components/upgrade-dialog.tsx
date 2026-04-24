import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Lock } from "lucide-react";

const PRICING_URL = "https://scoutable.se/#pricing";

interface Props {
  open: boolean;
  onClose: () => void;
  featureName?: string;
}

export function UpgradeDialog({ open, onClose, featureName = "This feature" }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <DialogTitle className="text-center">{featureName} is a paid feature</DialogTitle>
          <DialogDescription className="text-center">
            Export your playlists as MP4 video files with a Rookie or Pro plan.
            Start with a 14-day free trial — no credit card required upfront.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            onClick={async () => { await openUrl(PRICING_URL); onClose(); }}
          >
            View plans &amp; upgrade
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
