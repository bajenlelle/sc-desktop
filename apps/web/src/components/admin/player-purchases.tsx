"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FORM_ROW_INPUT, FormRow, GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { Stepper } from "@/components/ui/stepper";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format-date";
import { formatKronor, seasonLabel } from "@scoutable/shared/lib/player-access";

interface PurchaseRow {
  id: string;
  email: string;
  kind: "single_game" | "season_pass";
  quantity: number;
  amount_total: number;
  currency: string;
  source: "stripe" | "admin";
  status: "paid" | "refunded";
  team_name: string | null;
  season_id: string | null;
  moves_used: number | null;
  note: string | null;
  created_at: string;
}

interface TeamOption {
  value: string;
  label: string;
}

const ERRORS: Record<string, string> = {
  user_not_found: "No user with that email",
  team_not_in_season: "That team has no games in the season on sale",
  already_have_pass: "This user already has a pass for that team",
  invalid_quantity: "Quantity must be 1 to 50",
};

/**
 * Player purchases: every single game and season pass, bought in Stripe or
 * given here (comps, support fixes, a second team for a dual licence, App
 * Store review accounts). Stripe purchases are refunded in the Stripe
 * Dashboard; the webhook takes them back.
 */
export function PlayerPurchases() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [kind, setKind] = useState<"single_game" | "season_pass">("single_game");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [teamId, setTeamId] = useState("");
  const [note, setNote] = useState("");
  const [granting, setGranting] = useState(false);

  async function loadRows() {
    const { data, error } = await createClient().rpc("admin_list_player_purchases", { p_limit: 200 });
    if (!error && data) setRows(data as PurchaseRow[]);
  }

  useEffect(() => {
    void loadRows();
    const supabase = createClient();
    void (async () => {
      const { data: cfg } = await supabase.from("app_config").select("value").eq("key", "season_pass_season").maybeSingle();
      const s = (cfg?.value as string | undefined) ?? null;
      setSeason(s);
      if (!s) return;
      const { data } = await supabase
        .from("league_team_sources")
        .select("league_team_id, league_id, name_seen")
        .eq("source", "genius")
        .eq("season_id", s);
      const seen = new Map<string, TeamOption>();
      for (const r of (data ?? []) as { league_team_id: string; league_id: string; name_seen: string }[]) {
        if (!seen.has(r.league_team_id)) seen.set(r.league_team_id, { value: r.league_team_id, label: `${r.name_seen} · ${r.league_id}` });
      }
      setTeams([...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "sv")));
    })();
  }, []);

  const teamOptions = useMemo(() => [{ value: "", label: "Choose team…" }, ...teams], [teams]);

  async function handleGrant() {
    if (!email.trim()) { toast.error("Enter a user email"); return; }
    if (kind === "season_pass" && !teamId) { toast.error("Choose a team"); return; }
    setGranting(true);
    try {
      const { error } = await createClient().rpc("admin_grant_player_purchase", {
        p_email: email.trim(),
        p_kind: kind,
        p_quantity: kind === "single_game" ? quantity : 1,
        p_league_team_id: kind === "season_pass" ? teamId : null,
        p_season_id: null,
        p_note: note.trim() || null,
      });
      if (error) {
        const token = Object.keys(ERRORS).find((k) => error.message.includes(k));
        toast.error(token ? ERRORS[token] : `Failed: ${error.message}`);
        return;
      }
      toast.success(kind === "season_pass" ? `Season pass added for ${email.trim()}` : `${quantity} ${quantity === 1 ? "game" : "games"} added for ${email.trim()}`);
      setEmail(""); setNote("");
      await loadRows();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(id: string) {
    const { error } = await createClient().rpc("admin_revoke_player_purchase", { p_purchase_id: id });
    if (error) { toast.error(`Failed to revoke: ${error.message}`); return; }
    toast.success("Grant revoked");
    await loadRows();
  }

  return (
    <div className="space-y-7">
      <section>
        <GroupHeader title="Give games or a season pass" />
        <GroupedList>
          <FormRow label="What">
            <PopUpButton
              aria-label="What to give"
              align="end"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "single_game", label: "Single games" },
                { value: "season_pass", label: season ? `Season pass ${seasonLabel(season)}` : "Season pass" },
              ]}
            />
          </FormRow>
          <FormRow label="Email" htmlFor="pp-email">
            <Input id="pp-email" type="email" placeholder="player@club.se" className={FORM_ROW_INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormRow>
          {kind === "single_game" ? (
            <FormRow label="Games">
              <Stepper label="Games" value={quantity} onChange={setQuantity} min={1} max={50} />
            </FormRow>
          ) : (
            <FormRow label="Team">
              <PopUpButton aria-label="Team" align="end" value={teamId} onValueChange={setTeamId} options={teamOptions} />
            </FormRow>
          )}
          <FormRow label="Note" htmlFor="pp-note">
            <Input id="pp-note" placeholder="Dual licence, second team" className={FORM_ROW_INPUT} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormRow>
        </GroupedList>
        <div className="flex items-start justify-between gap-4 px-1 pt-2">
          <p className="text-subheadline text-muted-foreground">
            Free of charge. Works like a purchase: the games count as bought and export opens.
          </p>
          <Button size="sm" onClick={handleGrant} disabled={granting} className="shrink-0">
            {granting && <Loader2 className="animate-spin" />}
            Give
          </Button>
        </div>
      </section>

      <section>
        <GroupHeader
          title={
            <>
              Player purchases <span className="font-normal text-muted-foreground nums">{rows.length}</span>
            </>
          }
        />
        <GroupedList>
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-callout text-muted-foreground">No player purchases yet.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {r.email}{" "}
                    <span className="text-muted-foreground">
                      {r.kind === "season_pass"
                        ? `Season pass ${r.season_id ? seasonLabel(r.season_id) : ""}${r.team_name ? ` · ${r.team_name}` : ""}`
                        : `${r.quantity} ${r.quantity === 1 ? "game" : "games"}`}
                    </span>
                  </span>
                  <span className="truncate text-callout text-muted-foreground nums">
                    {formatDate(r.created_at)} · {r.source === "admin" ? "Given" : formatKronor(r.amount_total)}
                    {r.status === "refunded" && " · Refunded"}
                    {r.moves_used ? " · Moved once" : ""}
                    {r.note && ` · ${r.note}`}
                  </span>
                </div>
                {r.source === "admin" && r.status === "paid" && (
                  <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" onClick={() => void handleRevoke(r.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))
          )}
        </GroupedList>
        <GroupFooter>Revoking a given purchase stops new imports with it. Games already imported stay.</GroupFooter>
      </section>
    </div>
  );
}
