"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TeamPicker } from "@/components/team-picker";
import { useMyTeam, useSpaceSuggestions, useTeamCatalog } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import {
  TEAM_STEP_SUBTITLE,
  alsoUseLabel,
  spaceLabel,
  teamStepTitle,
} from "@scoutable/shared/lib/league-teams";
import type { TeamRole } from "@scoutable/shared/types/league-team";
import type { OrgMembership } from "@scoutable/shared/types/org";

interface TeamDialogProps {
  /** step: the once-per-space onboarding question. change: from Profile. */
  mode: "step" | "change";
  /** The space being answered for. */
  org: OrgMembership;
  /** Spaces offered as "Also use this team in …". */
  otherSpaces: OrgMembership[];
  defaultChecked: string[];
  initialTeamId: string | null;
  role: TeamRole | null;
  /** Answered: saved a team, a note, or skipped. */
  onDone: () => void;
  /** Closed without answering. */
  onDismiss: () => void;
}

export function TeamDialog({ mode, org, otherSpaces, defaultChecked, initialTeamId, role, onDone, onDismiss }: TeamDialogProps) {
  const { save } = useMyTeam();
  const { teams, failed, retry } = useTeamCatalog();
  const suggestedIds = useSpaceSuggestions(org.orgId, org.isPersonal);
  const [selectedId, setSelectedId] = useState<string | null>(initialTeamId);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(defaultChecked));
  const [noteMode, setNoteMode] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const surface = mode === "step" ? "step" : "profile";

  const orgIds = () => [org.orgId, ...otherSpaces.filter((o) => checked.has(o.orgId)).map((o) => o.orgId)];
  const canSave = noteMode ? note.trim().length > 0 : selectedId !== null;

  async function handleSave() {
    if (!canSave || saving) return;
    const ids = orgIds();
    setSaving(true);
    try {
      if (noteMode) {
        await save(ids, { unlistedTeam: note.trim() });
        trackEvent("team_unlisted", { surface, spaces: ids.length });
        toast.success("Thanks, we've noted it.");
      } else {
        const team = teams?.find((t) => t.id === selectedId);
        await save(ids, { teamId: selectedId });
        trackEvent("team_selected", {
          surface,
          league_id: team?.leagueId ?? null,
          team_name: team?.name ?? null,
          suggested: selectedId !== null && suggestedIds.has(selectedId),
          spaces: ids.length,
          includes_personal: [org, ...otherSpaces].some((o) => o.isPersonal && ids.includes(o.orgId)),
        });
        if (mode === "change") toast.success("Team saved");
      }
      onDone();
    } catch (e) {
      console.error("[team] save failed:", e);
      toast.error("Couldn't save your team. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSkip() {
    setSaving(true);
    try {
      await save([org.orgId], {});
      trackEvent("team_step_skipped");
      onDone();
    } catch (e) {
      console.error("[team] skip failed:", e);
      onDismiss(); // don't trap them in the step; it comes back next launch
    } finally {
      setSaving(false);
    }
  }

  function toggle(orgId: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(orgId);
      else next.delete(orgId);
      return next;
    });
  }

  const spaceName = spaceLabel(org);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onDismiss(); }}>
      <DialogContent className="max-w-lg" showCloseButton={mode === "change"}>
        <DialogHeader>
          <p className="text-xs font-medium text-muted-foreground">
            In {org.isPersonal ? spaceName : <span className="text-foreground">{spaceName}</span>}
          </p>
          <DialogTitle>{teamStepTitle(role)}</DialogTitle>
          <DialogDescription>
            {mode === "step" ? TEAM_STEP_SUBTITLE : "We'll use it to find your games when you import."}
          </DialogDescription>
        </DialogHeader>

        {noteMode ? (
          <div className="space-y-1.5">
            <Label htmlFor="unlisted-team">Team and league</Label>
            <Input
              id="unlisted-team"
              autoFocus
              maxLength={120}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
              placeholder="e.g. Sollentuna U16, Division 2"
            />
            <p className="text-xs text-muted-foreground">
              We only cover a few leagues so far. Telling us yours helps us decide which to add next.
            </p>
          </div>
        ) : failed ? (
          <div className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Couldn&apos;t load the teams.{" "}
            <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={retry}>
              Try again
            </button>
          </div>
        ) : teams === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TeamPicker
            teams={teams}
            suggestedIds={suggestedIds}
            selectedId={selectedId}
            onSelect={(t) => setSelectedId(t.id)}
          />
        )}

        {otherSpaces.length > 0 && (
          <div className="space-y-1.5">
            {otherSpaces.map((o) => (
              <label key={o.orgId} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  checked={checked.has(o.orgId)}
                  onChange={(e) => toggle(o.orgId, e.target.checked)}
                />
                {alsoUseLabel(o)}
              </label>
            ))}
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <button
            type="button"
            className="text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setNoteMode((v) => !v)}
          >
            {noteMode ? "Back to the list" : "My team isn't listed"}
          </button>
          <div className="flex gap-2">
            {mode === "step" ? (
              <Button variant="ghost" onClick={handleSkip} disabled={saving}>
                Skip for now
              </Button>
            ) : (
              <Button variant="ghost" onClick={onDismiss} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {noteMode ? "Send" : mode === "step" ? "Continue" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
