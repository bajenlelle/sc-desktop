"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
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

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "—");

/**
 * Users who used every free import and haven't upgraded (PRODUCT.md,
 * 2026-10-01), refilled by hand for now. The email goes only to users with
 * marketing consent; everyone else gets the imports without one.
 */
export function FreeRefillsCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<NumberSetting, string>>({
    amount: "", wait_days: "", expires_days: "", cooldown_days: "",
  });
  const [requireConsent, setRequireConsent] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [rows, setRows] = useState<FreeRefillCandidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    const what = `${settings?.amount ?? "?"} free imports to ${row.email}`;
    const mail = row.will_email
      ? "They'll get the refill email."
      : "No email: they've unsubscribed, or haven't opted in while opt-in is required.";
    const ask = force
      ? `${row.email} isn't due until ${day(row.eligible_at)}. Refill now anyway?\n\nGives ${what}. ${mail}`
      : `Give ${what}?\n\n${mail}`;
    if (!window.confirm(ask)) return;
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

  const field = (k: NumberSetting, label: string) => (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        min={k === "amount" || k === "expires_days" ? 1 : 0}
        value={draft[k]}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        className="h-9 w-24"
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Free refills</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Users who used every free import and haven&apos;t upgraded. A refill is an import grant that
            expires, and the user gets an email with an upgrade offer unless they&apos;ve unsubscribed.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {field("amount", "Imports per refill")}
          {field("wait_days", "Wait (days)")}
          {field("expires_days", "Expires after (days)")}
          {field("cooldown_days", "Cooldown (days)")}
          <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={requireConsent}
              onChange={(e) => setRequireConsent(e.target.checked)}
            />
            Only email users who opted in
          </label>
          <Button onClick={saveSettings} disabled={savingSettings || !settings} variant="outline" className="h-9">
            {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>

        {rows === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has used up the free tier right now.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? "user" : "users"} · {rows.filter((r) => r.eligible_now).length} due now
              </p>
              <button
                type="button"
                onClick={exportCsv}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-2 py-2 font-medium text-muted-foreground">User</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Imports</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Last import</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Last refill</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Due</th>
                    <th className="px-2 py-2 font-medium text-muted-foreground">Email</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} className="border-b border-border last:border-0">
                      <td className="px-2 py-2">
                        <div>{r.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.full_name, r.declared_role, r.in_club && "in a club", r.had_subscription && "paid before"]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-2 tabular-nums">{r.used}/{r.allowance}</td>
                      <td className="px-2 py-2 text-muted-foreground">{day(r.last_import_at)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{day(r.last_refill_at)}</td>
                      <td className="px-2 py-2">{r.eligible_now ? "Now" : day(r.eligible_at)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{r.will_email ? "Will email" : "No email"}</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant={r.eligible_now ? "default" : "outline"}
                          disabled={busyId !== null}
                          onClick={() => refill(r)}
                        >
                          {busyId === r.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refill"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
