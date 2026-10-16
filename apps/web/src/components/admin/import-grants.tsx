"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FORM_ROW_DATE, FORM_ROW_INPUT, FormRow, GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { Stepper } from "@/components/ui/stepper";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format-date";

interface GrantRow {
  id: string;
  user_email: string | null;
  amount: number;
  reason: string | null;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

/**
 * Campaign import grants: bonus imports for one user (re-activation) or every
 * user (season-start), active within a date window. Server-side quota math
 * picks these up automatically — see the import_grants migration.
 */
export function ImportGrants() {
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [scope, setScope] = useState<"all" | "user">("user");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(2);
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [granting, setGranting] = useState(false);

  async function loadGrants() {
    const { data, error } = await createClient().rpc("list_import_grants");
    if (!error && data) setGrants(data as GrantRow[]);
  }

  useEffect(() => { loadGrants(); }, []);

  async function handleGrant() {
    const n = amount;
    if (!n || n <= 0) { toast.error("Amount must be a positive number"); return; }
    if (scope === "user" && !email.trim()) { toast.error("Enter a user email"); return; }
    setGranting(true);
    try {
      const { error } = await createClient().rpc("grant_import_credits", {
        p_email: scope === "user" ? email.trim() : null,
        p_amount: n,
        p_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        p_reason: reason.trim() || null,
      });
      if (error) {
        toast.error(error.message.includes("user_not_found") ? "No user with that email" : `Failed: ${error.message}`);
        return;
      }
      toast.success(scope === "all" ? `Granted +${n} imports to all users` : `Granted +${n} imports to ${email.trim()}`);
      setEmail(""); setReason("");
      await loadGrants();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(id: string) {
    const { error } = await createClient().rpc("revoke_import_grant", { p_grant_id: id });
    if (error) { toast.error(`Failed to revoke: ${error.message}`); return; }
    toast.success("Grant revoked");
    await loadGrants();
  }

  return (
    <div className="space-y-7">
      <section>
        <GroupHeader title="Grant imports" />
        <GroupedList>
          <FormRow label="For">
            <PopUpButton
              aria-label="Grant to"
              align="end"
              value={scope}
              onValueChange={setScope}
              options={[
                { value: "user", label: "One user" },
                { value: "all", label: "Every user" },
              ]}
            />
          </FormRow>
          {scope === "user" && (
            <FormRow label="Email" htmlFor="grant-email">
              <Input
                id="grant-email"
                type="email"
                placeholder="coach@club.se"
                className={FORM_ROW_INPUT}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormRow>
          )}
          <FormRow label="Extra imports">
            <Stepper label="Extra imports" value={amount} onChange={setAmount} min={1} max={100} />
          </FormRow>
          <FormRow label="Expires" htmlFor="grant-expires" description="Optional">
            <Input id="grant-expires" type="date" className={FORM_ROW_DATE} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </FormRow>
          <FormRow label="Reason" htmlFor="grant-reason">
            <Input
              id="grant-reason"
              placeholder="Season start 2026"
              className={FORM_ROW_INPUT}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormRow>
        </GroupedList>
        <div className="flex items-start justify-between gap-4 px-1 pt-2">
          <p className="text-subheadline text-muted-foreground">
            Bonus imports on top of the plan&apos;s limit, for one user or a campaign for everyone. They count while the
            grant is active; quota math applies them automatically.
          </p>
          <Button size="sm" onClick={handleGrant} disabled={granting} className="shrink-0">
            {granting && <Loader2 className="animate-spin" />}
            Grant
          </Button>
        </div>
      </section>

      <section>
        <GroupHeader
          title={
            <>
              Grants <span className="font-normal text-muted-foreground nums">{grants.length}</span>
            </>
          }
        />
        <GroupedList>
          {grants.length === 0 ? (
            <p className="px-4 py-3 text-callout text-muted-foreground">No grants yet.</p>
          ) : (
            grants.map((g) => (
              <div key={g.id} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {g.user_email ?? <span className="font-medium">Every user</span>}{" "}
                    <span className="text-muted-foreground nums">+{g.amount}</span>
                  </span>
                  <span className="truncate text-callout text-muted-foreground nums">
                    {formatDate(g.starts_at)} – {g.expires_at ? formatDate(g.expires_at) : "no expiry"}
                    {g.reason && ` · ${g.reason}`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => void handleRevoke(g.id)}
                >
                  Revoke
                </Button>
              </div>
            ))
          )}
        </GroupedList>
        <GroupFooter>Revoking removes the grant. Games already imported with it stay.</GroupFooter>
      </section>
    </div>
  );
}
