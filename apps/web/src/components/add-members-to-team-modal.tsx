"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Check, Loader2, Search, X } from "lucide-react";
import { assignMemberToTeam } from "@/lib/profile-db";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { toast } from "sonner";

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

function initials(member: UserProfile): string {
  const name = member.fullName ?? member.email ?? "?";
  return name[0].toUpperCase();
}

interface AddMembersToTeamModalProps {
  open: boolean;
  onClose: () => void;
  team: OrgTeam;
  orgMembers: UserProfile[];
  currentTeamMemberIds: Set<string>;
  onAdded: () => void;
}

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

  // Reset on open
  function handleOpenChange(v: boolean) {
    if (!v) {
      setSearchQuery("");
      setSelectedIds(new Set());
      onClose();
    }
  }

  const availableToAdd = useMemo(
    () => orgMembers.filter((m) => !currentTeamMemberIds.has(m.id)),
    [orgMembers, currentTeamMemberIds]
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return availableToAdd;
    const q = searchQuery.toLowerCase();
    return availableToAdd.filter(
      (m) =>
        m.fullName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
    );
  }, [availableToAdd, searchQuery]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deselect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const selectedMembers = orgMembers.filter((m) => selectedIds.has(m.id));

  async function handleAdd() {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      for (const userId of selectedIds) {
        const member = orgMembers.find((m) => m.id === userId)!;
        await assignMemberToTeam(userId, team.id, member.role as "coach" | "player");
      }
      toast.success(
        `${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""} added to ${team.name}`
      );
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
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name or email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Selected chips */}
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedMembers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1 font-medium"
                >
                  {m.fullName ?? m.email ?? m.id.slice(0, 8)}
                  <button
                    type="button"
                    className="hover:text-primary/60 transition-colors"
                    onClick={() => deselect(m.id)}
                    aria-label={`Remove ${m.fullName ?? m.email}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Member list */}
          {availableToAdd.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              All org members are already in this team.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No members match &ldquo;{searchQuery}&rdquo;.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto -mx-1 space-y-0.5">
              {filtered.map((m) => {
                const selected = selectedIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent transition-colors"
                  >
                    {/* Checkbox indicator */}
                    <div
                      className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                        selected
                          ? "bg-primary border-primary"
                          : "border-input bg-background"
                      }`}
                    >
                      {selected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>

                    <Avatar size="sm">
                      <AvatarImage src={m.avatarUrl ?? undefined} />
                      <AvatarFallback>{initials(m)}</AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {m.fullName ?? m.email ?? m.id.slice(0, 8)}
                      </p>
                      {m.fullName && m.email && (
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      )}
                    </div>

                    <Badge variant={roleBadgeVariant(m.role)} className="text-xs shrink-0">
                      {m.role}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={selectedIds.size === 0 || adding}
          >
            {adding && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {adding
              ? "Adding…"
              : selectedIds.size > 0
              ? `Add ${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""}`
              : "Add members"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
