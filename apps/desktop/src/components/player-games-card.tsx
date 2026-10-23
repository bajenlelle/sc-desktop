import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout, GroupFooter, GroupHeader, GroupedList, GroupRow } from "@/components/ui/group";
import { TeamPicker } from "@/components/team-picker";
import { PurchaseSheet } from "@/components/purchase-sheet";
import { usePlayerAccess } from "@/lib/player-access";
import { useMyTeam, useTeamCatalog } from "@/lib/my-team";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/format-date";
import {
  PLAYER_PRICES,
  PRO_PRICES,
  activePass,
  formatKronor,
  purchaseLabel,
  seasonLabel,
  type SeasonPass,
} from "@scoutable/shared/lib/player-access";

const MOVE_ERRORS: Record<string, string> = {
  no_moves_left: "This pass has already been moved once. Email hello@scoutable.se to move it again.",
  team_not_in_season: "That team has no games this season.",
  already_have_pass: "You already have a season pass for that team.",
  same_team: "The pass is already on that team.",
};

/** Moves a season pass to another team in its season (once per pass). */
async function movePass(pass: SeasonPass, teamId: string, teamName: string): Promise<boolean> {
  const { error } = await createClient().rpc("move_season_pass", { p_pass_id: pass.id, p_league_team_id: teamId });
  if (error) {
    const token = Object.keys(MOVE_ERRORS).find((k) => error.message.includes(k));
    toast.error(token ? MOVE_ERRORS[token] : "Couldn't move the pass. Try again.");
    return false;
  }
  trackEvent("season_pass_moved", { from_team: pass.teamName, to_team: teamName });
  toast.success(`Season pass moved to ${teamName}`);
  return true;
}

function MovePassDialog({ pass, onClose, onMoved }: { pass: SeasonPass; onClose: () => void; onMoved: () => void }) {
  const { teams, failed, retry } = useTeamCatalog();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The catalogue is the current season; a pass moves within its own season.
  const eligible = useMemo(
    () => teams?.filter((t) => t.seasonId === pass.seasonId && t.id !== pass.teamId) ?? null,
    [teams, pass.seasonId, pass.teamId],
  );
  const noSuggestions = useMemo(() => new Set<string>(), []);

  async function handleMove() {
    const team = eligible?.find((t) => t.id === selectedId);
    if (!team || saving) return;
    setSaving(true);
    try {
      if (await movePass(pass, team.id, team.name)) {
        onMoved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move your season pass</DialogTitle>
          <DialogDescription>
            For a new team this season, once. Games you&apos;ve already imported stay yours.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <Callout action={<Button size="xs" variant="outline" onClick={retry}>Try again</Button>}>
            Couldn&apos;t load the teams.
          </Callout>
        ) : eligible === null ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TeamPicker teams={eligible} suggestedIds={noSuggestions} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleMove()} disabled={!selectedId || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Move pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Your games" on the Profile page of a Free personal space with player
 * passes on: the season pass (with its one move), free and bought games,
 * receipts, and a way to buy. Renders nothing otherwise.
 */
export function PlayerGamesCard() {
  const { access, playerMode, reload } = usePlayerAccess();
  const { choices } = useMyTeam();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [prompt, setPrompt] = useState<{ teamId: string; teamName: string } | null>(null);
  const [moving, setMoving] = useState(false);

  const pass = access ? activePass(access) : null;
  const personalChoice = access?.personalOrgId ? choices.find((c) => c.orgId === access.personalOrgId) : undefined;
  const personalTeam = personalChoice?.team ?? null;

  // Changing "Your team" in the personal space while holding a pass with its
  // move left: offer to move the pass too (it never follows on its own).
  const prevTeamIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevTeamIdRef.current;
    const next = personalTeam?.id ?? null;
    prevTeamIdRef.current = next;
    if (prev === undefined || prev === next || !next || !personalTeam) return;
    if (!pass || pass.movesLeft <= 0 || pass.teamId === next || personalTeam.seasonId !== pass.seasonId) return;
    setPrompt({ teamId: next, teamName: personalTeam.name });
    // pass is read at the moment the team changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalTeam?.id]);

  if (!playerMode || !access) return null;
  const boughtSingles = access.purchases.some((p) => p.kind === "single_game");

  async function confirmMove() {
    if (!prompt || !pass) return;
    setMoving(true);
    try {
      if (await movePass(pass, prompt.teamId, prompt.teamName)) void reload();
    } finally {
      setMoving(false);
      setPrompt(null);
    }
  }

  return (
    <>
      <section>
        <GroupHeader title="Your games" />
        <GroupedList>
          {pass && (
            <GroupRow
              label={`Season pass ${seasonLabel(pass.seasonId)}`}
              description={`${pass.teamName} · ${pass.leagueName}`}
              trailing={
                pass.movesLeft > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
                    Move…
                  </Button>
                ) : (
                  <span className="text-callout text-muted-foreground">Moved once</span>
                )
              }
            />
          )}
          <GroupRow
            label="Free games"
            trailing={<span className="nums">{access.trialLeft} of {access.trialGames} left</span>}
          />
          {boughtSingles && (
            <GroupRow label="Bought games" trailing={<span className="nums">{access.singlesLeft} left</span>} />
          )}
          {access.purchases.map((p) => (
            <GroupRow
              key={p.id}
              label={purchaseLabel(p)}
              description={[
                formatDate(p.createdAt, "long"),
                p.source === "admin" ? "Added by Scoutable" : formatKronor(p.amountTotal),
                p.status === "refunded" ? "Refunded" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              trailing={
                p.receiptUrl ? (
                  <Button variant="ghost" size="sm" onClick={() => void openUrl(p.receiptUrl!)}>
                    Receipt
                  </Button>
                ) : undefined
              }
            />
          ))}
          <GroupRow
            label="Buy games"
            description={`A single game is ${PLAYER_PRICES.singleGame} kr. Pro covers every game of any team for ${PRO_PRICES.monthly} kr a month.`}
            trailing={
              <Button size="sm" onClick={() => setSheetOpen(true)}>
                Buy…
              </Button>
            }
          />
        </GroupedList>
        <GroupFooter>Any purchase opens export for all your games. Re-importing a game is always free.</GroupFooter>
      </section>

      <PurchaseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Buy games"
        surface="profile"
        game={null}
        analyticsFeature="profile"
      />
      {moveOpen && pass && <MovePassDialog pass={pass} onClose={() => setMoveOpen(false)} onMoved={() => void reload()} />}
      {prompt && pass && (
        <Dialog open onOpenChange={(v) => { if (!v && !moving) setPrompt(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Move your season pass to {prompt.teamName} too?</DialogTitle>
              <DialogDescription>
                You can move it once this season. Games you&apos;ve already imported stay yours.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPrompt(null)} disabled={moving}>
                Keep on {pass.teamName}
              </Button>
              <Button onClick={() => void confirmMove()} disabled={moving}>
                {moving && <Loader2 className="animate-spin" />}
                Move pass
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
