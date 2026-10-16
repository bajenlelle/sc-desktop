"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { initials } from "@scoutable/shared/lib/playlist-feed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GroupedList } from "@/components/ui/group";
import { SearchField } from "@/components/ui/search-field";
import { assignMemberToTeam } from "@/lib/profile-db";
import { pressable } from "@/lib/pressable";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";

interface AddMembersToTeamModalProps {
  open: boolean;
  onClose: () => void;
  team: OrgTeam;
  orgMembers: UserProfile[];
  currentTeamMemberIds: Set<string>;
  onAdded: () => void;
}

/** Club members who aren't on the team yet, each a row that toggles with a check. */
export function AddMembersToTeamModal({
  open,
  onClose,
  team,
  orgMembers,
  currentTeamMemberIds,
  onAdded,
}: AddMembersToTeamModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  function handleOpenChange(v: boolean) {
    if (!v) {
      setSearchQuery("");
      setSelectedIds(new Set());
      onClose();
    }
  }

  const availableToAdd = useMemo(
    () => orgMembers.filter((m) => !currentTeamMemberIds.has(m.id)),
    [orgMembers, currentTeamMemberIds],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableToAdd;
    return availableToAdd.filter((m) => m.fullName?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
  }, [availableToAdd, searchQuery]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      for (const userId of selectedIds) {
        const member = orgMembers.find((m) => m.id === userId)!;
        await assignMemberToTeam(userId, team.id, member.role === "player" ? "player" : "coach");
      }
      toast.success(`${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""} added to ${team.name}`);
      onAdded();
      handleOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add members to {team.name}</DialogTitle>
          <DialogDescription>Choose from the people already in the club.</DialogDescription>
        </DialogHeader>

        {availableToAdd.length === 0 ? (
          <p className="py-6 text-center text-callout text-muted-foreground">Everyone in the club is already on this team.</p>
        ) : (
          <div className="grid gap-2">
            {availableToAdd.length > 6 && (
              <SearchField
                placeholder="Search by name or email"
                aria-label="Search members"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            )}
            <GroupedList className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3 py-2.5 text-callout text-muted-foreground">No one matches “{searchQuery}”.</p>
              ) : (
                filtered.map((m) => {
                  const selected = selectedIds.has(m.id);
                  const name = m.fullName ?? m.email ?? m.id.slice(0, 8);
                  return (
                    <div
                      key={m.id}
                      {...pressable(() => toggle(m.id), { role: "checkbox", checked: selected })}
                      className="flex min-h-11 cursor-default items-center gap-3 px-3 py-1.5 outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-caption font-semibold text-primary">
                        {initials(name)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{name}</span>
                        {m.fullName && m.email && <span className="truncate text-callout text-muted-foreground">{m.email}</span>}
                      </span>
                      <span className="shrink-0 text-callout text-muted-foreground">{roleLabel(m.role)}</span>
                      <Check
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0 stroke-[2.5] text-primary transition-[opacity,transform] duration-150",
                          selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
                        )}
                      />
                    </div>
                  );
                })
              )}
            </GroupedList>
          </div>
        )}

        <DialogFooter>
          {selectedIds.size > 0 && (
            <span className="mr-auto self-center text-callout text-muted-foreground nums">{selectedIds.size} selected</span>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={selectedIds.size === 0 || adding}>
            {adding && <Loader2 className="animate-spin" />}
            {selectedIds.size > 0 ? `Add ${selectedIds.size}` : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
