"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { AutoHeight } from "@/components/ui/auto-height";
import { Callout, GroupedList } from "@/components/ui/group";
import { Switch } from "@/components/ui/switch";
import { fadeVariants } from "@/lib/motion";
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
          <DialogTitle>{teamStepTitle(role)}</DialogTitle>
          <DialogDescription>
            {org.isPersonal ? "For your personal space. " : `For ${spaceName}. `}
            {mode === "step" ? TEAM_STEP_SUBTITLE : "We use it to find your games when you import."}
          </DialogDescription>
        </DialogHeader>

        {/* The body changes shape (list, note, loading, error): the height
            springs and the contents cross-fade. */}
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={noteMode ? "note" : failed ? "failed" : teams === null ? "loading" : "list"}
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {noteMode ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="unlisted-team">Team and league</Label>
                  <Input
                    id="unlisted-team"
                    autoFocus
                    maxLength={120}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSave();
                    }}
                    placeholder="Sollentuna U16, Division 2"
                  />
                  <p className="text-callout text-muted-foreground">
                    We only cover a few leagues so far. Telling us yours helps us decide which to add next.
                  </p>
                </div>
              ) : failed ? (
                <Callout
                  tone="neutral"
                  action={
                    <Button size="xs" variant="outline" onClick={retry}>
                      Try again
                    </Button>
                  }
                >
                  Couldn&apos;t load the teams.
                </Callout>
              ) : teams === null ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <TeamPicker
                  teams={teams}
                  suggestedIds={suggestedIds}
                  selectedId={selectedId}
                  onSelect={(t) => setSelectedId(t.id)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>

        {otherSpaces.length > 0 && (
          <GroupedList>
            {otherSpaces.map((o) => (
              <label key={o.orgId} className="flex min-h-10 cursor-default items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{alsoUseLabel(o)}</span>
                <Switch checked={checked.has(o.orgId)} onCheckedChange={(v) => toggle(o.orgId, v)} />
              </label>
            ))}
          </GroupedList>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="ghost" size="sm" className="-ml-2 text-primary" onClick={() => setNoteMode((v) => !v)}>
            {noteMode ? "Back to the list" : "My team isn't listed"}
          </Button>
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
              {saving && <Loader2 className="animate-spin" />}
              {noteMode ? "Send" : mode === "step" ? "Continue" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
