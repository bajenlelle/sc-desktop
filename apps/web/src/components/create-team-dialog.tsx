"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormRow, GroupedList } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { createTeam } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";

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
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await createTeam(name.trim(), season.trim() || undefined, orgId);
      trackEvent("team_created");
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

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleCreate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Invites can name a team, so new members land in the right place.</DialogDescription>
        </DialogHeader>
        <GroupedList>
          <FormRow label="Name" htmlFor="team-name">
            <Input
              id="team-name"
              className="h-7 border-0 bg-transparent px-0 text-right shadow-none ring-0 focus-visible:ring-0"
              placeholder="U21"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              autoFocus
            />
          </FormRow>
          <FormRow label="Season" htmlFor="team-season" description="Optional">
            <Input
              id="team-season"
              className="h-7 border-0 bg-transparent px-0 text-right shadow-none ring-0 focus-visible:ring-0"
              placeholder="2026/27"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              onKeyDown={onEnter}
            />
          </FormRow>
        </GroupedList>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating && <Loader2 className="animate-spin" />}
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
