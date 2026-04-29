import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { createTeam } from "@/lib/profile-db";
import { toast } from "sonner";

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  orgId?: string;
}

export function CreateTeamDialog({ open, onClose, onCreated, orgId }: CreateTeamDialogProps) {
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [creating, setCreating] = useState(false);

  function handleOpenChange(v: boolean) {
    if (!v) {
      setName("");
      setSeason("");
      onClose();
    }
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createTeam(name.trim(), season.trim() || undefined, orgId);
      toast.success("Team created");
      setName("");
      setSeason("");
      onCreated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Team name</Label>
            <Input
              placeholder="e.g. U21"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Season <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              placeholder="e.g. 2024/25"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
