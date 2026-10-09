"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FORM_ROW_INPUT, FormRow, GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "@/components/person-avatar";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  refillCandidatesCsv,
  refillErrorMessage,
  type FreeRefillCandidate,
} from "@scoutable/shared/lib/free-refills";

interface Settings {
  amount: number;
  wait_days: number;
  expires_days: number;
  cooldown_days: number;
  email_requires_consent: boolean;
}

type NumberSetting = Exclude<keyof Settings, "email_requires_consent">;

const day = (iso: string | null) => (iso ? formatDate(iso) : "never");

/**
 * Users who used every free import and haven't upgraded (PRODUCT.md,
 * 2026-10-01), refilled by hand for now. The email goes only to users with
 * marketing consent; everyone else gets the imports without one.
 */
export function FreeRefills() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<NumberSetting, string>>({
    amount: "", wait_days: "", expires_days: "", cooldown_days: "",
  });
  const [requireConsent, setRequireConsent] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [rows, setRows] = useState<FreeRefillCandidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The row whose refill waits for a yes in the confirmation dialog.
  const [confirming, setConfirming] = useState<FreeRefillCandidate | null>(null);

  async function load() {
    const supabase = createClient();
    const [s, c] = await Promise.all([
      supabase.rpc("get_free_refill_settings"),
      supabase.rpc("free_refill_candidates"),
    ]);
    if (!s.error && s.data) {
      const v = s.data as Settings;
      setSettings(v);
      setDraft({
        amount: String(v.amount),
        wait_days: String(v.wait_days),
        expires_days: String(v.expires_days),
        cooldown_days: String(v.cooldown_days),
      });
      setRequireConsent(v.email_requires_consent);
    }
    setRows(c.error ? [] : ((c.data ?? []) as FreeRefillCandidate[]));
  }

  useEffect(() => { load(); }, []);

  async function saveSettings() {
    const n = (k: NumberSetting) => parseInt(draft[k], 10);
    if ([n("amount"), n("expires_days")].some((v) => !v || v < 1) || [n("wait_days"), n("cooldown_days")].some((v) => isNaN(v) || v < 0)) {
      toast.error("Amount and expiry must be at least 1; wait and cooldown at least 0.");
      return;
    }
    setSavingSettings(true);
    try {
      const { error } = await createClient().rpc("update_free_refill_settings", {
        p_amount: n("amount"),
        p_wait_days: n("wait_days"),
        p_expires_days: n("expires_days"),
        p_cooldown_days: n("cooldown_days"),
        p_email_requires_consent: requireConsent,
      });
      if (error) { toast.error(`Failed to save: ${error.message}`); return; }
      toast.success("Refill settings saved");
      await load();
    } finally {
      setSavingSettings(false);
    }
  }

  async function refill(row: FreeRefillCandidate) {
    const force = !row.eligible_now;
    setBusyId(row.user_id);
    try {
      const { data, error } = await createClient().rpc("refill_free_imports", {
        p_user_id: row.user_id,
        p_force: force,
      });
      if (error) { toast.error(refillErrorMessage(error.message)); return; }
      const r = data as { granted: number; emailed: boolean };
      trackEvent("free_refill_granted", { amount: r.granted, emailed: r.emailed, forced: force });
      toast.success(`Gave ${r.granted} imports to ${row.email}${r.emailed ? " and emailed them" : ""}`);
      setConfirming(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    if (!rows) return;
    const blob = new Blob([refillCandidatesCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `free-refill-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const field = (k: NumberSetting, label: string, description?: string) => (
    <FormRow label={label} htmlFor={`refill-${k}`} description={description}>
      <Input
        id={`refill-${k}`}
        type="number"
        inputMode="numeric"
        min={k === "amount" || k === "expires_days" ? 1 : 0}
        value={draft[k]}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        className={cn(FORM_ROW_INPUT, "w-20")}
      />
      <span className="w-12 text-sm text-muted-foreground">{k === "amount" ? "imports" : "days"}</span>
    </FormRow>
  );

  const amount = settings?.amount ?? "?";
  const confirmForce = confirming ? !confirming.eligible_now : false;
  const confirmMail = confirming?.will_email
    ? "They'll get the refill email."
    : "No email: they've unsubscribed, or haven't opted in while opt-in is required.";

  return (
    <div className="space-y-7">
      <section>
        <GroupHeader title="Free refills" />
        <GroupedList>
          {field("amount", "Imports per refill")}
          {field("wait_days", "Wait", "After the last import")}
          {field("expires_days", "Expires after")}
          {field("cooldown_days", "Cooldown", "Between refills")}
          <FormRow label="Opt-in only" htmlFor="refill-consent" description="Email only users who opted in">
            <Switch id="refill-consent" checked={requireConsent} onCheckedChange={setRequireConsent} />
          </FormRow>
        </GroupedList>
        <div className="flex items-start justify-between gap-4 px-1 pt-2">
          <p className="text-subheadline text-muted-foreground">
            For users who used every free import and haven&apos;t upgraded. A refill is an import grant that
            expires, and the user gets an email with an upgrade offer unless they&apos;ve unsubscribed.
          </p>
          <Button size="sm" variant="outline" onClick={saveSettings} disabled={savingSettings || !settings} className="shrink-0">
            {savingSettings && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </section>

      <section>
        <GroupHeader
          title={
            <>
              Candidates{" "}
              {rows && rows.length > 0 && <span className="font-normal text-muted-foreground nums">{rows.length}</span>}
            </>
          }
          action={
            rows && rows.length > 0 ? (
              <Button size="xs" variant="ghost" className="text-primary" onClick={exportCsv}>
                Export CSV
              </Button>
            ) : undefined
          }
        />
        <GroupedList>
          {rows === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-3 text-callout text-muted-foreground">Nobody has used up the free tier right now.</p>
          ) : (
            rows.map((r) => (
              <div key={r.user_id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                <PersonAvatar name={r.full_name ?? r.email} className="size-7" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{r.email}</span>
                  <span className="truncate text-callout text-muted-foreground">
                    {[r.full_name, r.declared_role, r.in_club && "in a club", r.had_subscription && "paid before"]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                  <span className="truncate text-callout text-muted-foreground nums">
                    {r.used} of {r.allowance} imports used · last import {day(r.last_import_at)} · last refill{" "}
                    {day(r.last_refill_at)} · {r.will_email ? "will email" : "no email"}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-callout nums", r.eligible_now ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {r.eligible_now ? "Due now" : `Due ${day(r.eligible_at)}`}
                  </span>
                  <Button
                    size="xs"
                    variant={r.eligible_now ? "default" : "outline"}
                    disabled={busyId !== null}
                    onClick={() => setConfirming(r)}
                  >
                    {busyId === r.user_id && <Loader2 className="animate-spin" />}
                    Refill
                  </Button>
                </div>
              </div>
            ))
          )}
        </GroupedList>
        {rows && rows.length > 0 && (
          <GroupFooter className="nums">
            {rows.length} {rows.length === 1 ? "user" : "users"} · {rows.filter((r) => r.eligible_now).length} due now
          </GroupFooter>
        )}
      </section>

      {/* A refill gives imports and may send an email: it asks first, and says which. */}
      <Dialog open={!!confirming} onOpenChange={(o) => !o && busyId === null && setConfirming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmForce ? `Refill ${confirming?.email} early?` : `Give ${confirming?.email} ${amount} free imports?`}
            </DialogTitle>
            <DialogDescription>
              {confirmForce && `They're not due until ${day(confirming?.eligible_at ?? null)}. This gives ${amount} free imports. `}
              {confirmMail}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busyId !== null} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button disabled={busyId !== null} onClick={() => confirming && void refill(confirming)}>
              {busyId !== null && <Loader2 className="animate-spin" />}
              {confirmForce ? "Refill now" : "Refill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
