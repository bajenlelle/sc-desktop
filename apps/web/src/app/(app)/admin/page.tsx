"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAllOrgsWithCounts,
  createOrgForPlatform,
  sendEmailInvites,
  updateOrgPlanTier,
  unlockOrgPlanTier,
} from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";
import type { OrgWithCount, OrgPlanTier } from "@scoutable/shared/types/org";
import { getLicenseState } from "@scoutable/shared/lib/license-state";
import { LicenseBadge } from "@/components/license-badge";
import { useAuth } from "@/components/auth-context";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { getOrgContext } from "@/lib/profile-db";

type LicenseFilter = "all" | "expiring" | "expired" | "over_cap";

const FILTERS: Array<{ key: LicenseFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "over_cap", label: "Over cap" },
];

function isOverCap(org: OrgWithCount): boolean {
  return (
    (org.coachSeatLimit != null && org.coachCount > org.coachSeatLimit) ||
    (org.playerSeatLimit != null && org.playerCount > org.playerSeatLimit)
  );
}

function matchesFilter(org: OrgWithCount, filter: LicenseFilter): boolean {
  if (filter === "all") return true;
  if (org.isPersonal) return false; // personal orgs have no franchise license
  const state = getLicenseState(org.expiresAt);
  if (filter === "expiring") {
    // 45-day window mirrors the platform digest, wider than the badge's 30.
    return (
      !!org.expiresAt &&
      state !== "grace" &&
      state !== "locked" &&
      new Date(org.expiresAt).getTime() - Date.now() <= 45 * 24 * 60 * 60 * 1000
    );
  }
  if (filter === "expired") return state === "grace" || state === "locked";
  return isOverCap(org);
}

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<LicenseFilter>("all");

  useEffect(() => {
    if (!user) return;
    getOrgContext()
      .then((ctx) => {
        if (!ctx.profile.isPlatformAdmin) {
          router.replace("/organization");
        } else {
          setChecked(true);
        }
      })
      .catch(() => router.replace("/organization"));
  }, [user]);

  useEffect(() => {
    if (!checked) return;
    loadOrgs();
  }, [checked]);

  async function loadOrgs() {
    setLoading(true);
    try {
      setOrgs(await getAllOrgsWithCounts());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const visibleOrgs = useMemo(
    () => orgs.filter((o) => matchesFilter(o, filter)),
    [orgs, filter]
  );

  async function handlePlanTierChange(orgId: string, tier: OrgPlanTier) {
    try {
      await updateOrgPlanTier(orgId, tier);
      const lockedAt = new Date().toISOString();
      setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, planTier: tier, planTierLockedAt: lockedAt } : o));
      toast.success("Plan tier updated and locked");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleUnlockPlanTier(orgId: string) {
    try {
      await unlockOrgPlanTier(orgId);
      setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, planTierLockedAt: null } : o));
      toast.success("Plan tier unlocked — Stripe will drive future updates");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!checked) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Platform Admin</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">All organizations on the platform</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/feedback"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Feedback
          </Link>
          <Link
            href="/admin/devices"
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Devices
          </Link>
          <Button onClick={() => setDialogOpen(true)}>+ Create Org</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === f.key
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : visibleOrgs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {filter === "all" ? "No organizations yet." : "No organizations match this filter."}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Members</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Teams</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">License</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Plan</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrgs.map((org) => (
                    <tr
                      key={org.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/admin/orgs/${org.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">
                        {org.isPersonal ? (org.ownerEmail ?? "Personal") : org.name}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{org.memberCount}</td>
                      <td className="px-4 py-3 text-muted-foreground">{org.teamCount}</td>
                      <td className="px-4 py-3">
                        {org.isPersonal ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            <LicenseBadge expiresAt={org.expiresAt} />
                            {(org.coachSeatLimit != null || org.playerSeatLimit != null) && (
                              <p
                                className={`text-xs ${
                                  isOverCap(org) ? "text-destructive" : "text-muted-foreground"
                                }`}
                              >
                                C {org.coachCount}/{org.coachSeatLimit ?? "∞"} · P {org.playerCount}/
                                {org.playerSeatLimit ?? "∞"}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <select
                            value={org.planTier}
                            onChange={(e) => handlePlanTierChange(org.id, e.target.value as OrgPlanTier)}
                            className="text-xs rounded border border-border bg-background px-2 py-1 cursor-pointer"
                          >
                            <option value="free">Free</option>
                            <option value="rookie">Rookie</option>
                            <option value="pro">Pro</option>
                            <option value="franchise">Franchise</option>
                          </select>
                          {org.planTierLockedAt && (
                            <>
                              <span
                                className="text-[10px] uppercase tracking-wide font-medium text-amber-600 dark:text-amber-500"
                                title={`Locked at ${new Date(org.planTierLockedAt).toLocaleString()} — Stripe webhook will not overwrite`}
                              >
                                Manual
                              </span>
                              <button
                                type="button"
                                onClick={() => handleUnlockPlanTier(org.id)}
                                className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground underline underline-offset-2"
                                title="Unlock — let Stripe drive this org's plan tier again"
                              >
                                Unlock
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(org.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/orgs/${org.id}`);
                          }}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      <ImportGrantsCard />

      <CreateOrgDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={loadOrgs} />
    </div>
  );
}

/**
 * Org setup in one flow: name, plan, license, contact, and an optional email
 * invite for the customer's first admin — replaces the old name-only dialog
 * that left every new org unlimited/never-expiring until someone remembered
 * the license page.
 */
function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isNt, setIsNt] = useState(false);
  const [planTier, setPlanTier] = useState<OrgPlanTier>("franchise");
  const [coachSeats, setCoachSeats] = useState("");
  const [playerSeats, setPlayerSeats] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [creating, setCreating] = useState(false);

  function reset() {
    setName("");
    setIsNt(false);
    setPlanTier("franchise");
    setCoachSeats("");
    setPlayerSeats("");
    setExpiresAt("");
    setContactName("");
    setContactEmail("");
    setAdminEmail("");
  }

  async function handleCreate() {
    if (!name.trim()) return;
    const coach = coachSeats.trim() ? parseInt(coachSeats, 10) : null;
    const player = playerSeats.trim() ? parseInt(playerSeats, 10) : null;
    if ((coach != null && Number.isNaN(coach)) || (player != null && Number.isNaN(player))) {
      toast.error("Seat limits must be numbers.");
      return;
    }
    setCreating(true);
    try {
      const orgId = await createOrgForPlatform({
        name: name.trim(),
        isNtOrg: isNt,
        planTier,
        coachSeats: coach,
        playerSeats: player,
        // End of day, like the import-grants dialog — a license set to expire
        // "Mar 18" should last through Mar 18 locally, not die at UTC midnight.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
      });

      let summary = `${name.trim()} created`;
      if (adminEmail.trim()) {
        await sendEmailInvites(orgId, [adminEmail.trim()], "admin");
        summary += ` — admin invite sent to ${adminEmail.trim()}`;
      }
      toast.success(summary, {
        description:
          coach != null || player != null || expiresAt
            ? `${planTier} · ${coach ?? "∞"} coach / ${player ?? "∞"} player seats${
                expiresAt ? ` · expires ${expiresAt}` : ""
              }`
            : `${planTier} · no seat limits or expiry set`,
      });
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            placeholder="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isNt}
              onChange={(e) => setIsNt(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <div>
              <span className="text-sm font-medium">National Team organization</span>
              <p className="text-xs text-muted-foreground">
                Coaches join as secondary members (no org switch required)
              </p>
            </div>
          </label>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              License
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Plan tier</label>
                <select
                  value={planTier}
                  onChange={(e) => setPlanTier(e.target.value as OrgPlanTier)}
                  className="block h-9 w-full text-sm rounded-md border border-border bg-background px-2 cursor-pointer"
                >
                  <option value="franchise">Franchise</option>
                  <option value="free">Free</option>
                  <option value="rookie">Rookie</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Expiry date (blank = never)</label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Coach seats (blank = unlimited)</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="Unlimited"
                  value={coachSeats}
                  onChange={(e) => setCoachSeats(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Player seats (blank = unlimited)</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="Unlimited"
                  value={playerSeats}
                  onChange={(e) => setPlayerSeats(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Contact name</label>
                <Input
                  placeholder="Anna Andersson"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Contact email</label>
                <Input
                  type="email"
                  placeholder="kansli@club.se"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The contact gets license expiry reminders alongside org admins.
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              First admin
            </p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Invite first admin by email (optional)
              </label>
              <Input
                type="email"
                placeholder="coach@club.se"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                They get an email with a join link and land in the org as an admin. You can also
                generate an invite code later from the org page.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
function ImportGrantsCard() {
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [scope, setScope] = useState<"all" | "user">("user");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("2");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [granting, setGranting] = useState(false);

  async function loadGrants() {
    const { data, error } = await createClient().rpc("list_import_grants");
    if (!error && data) setGrants(data as GrantRow[]);
  }

  useEffect(() => { loadGrants(); }, []);

  async function handleGrant() {
    const n = parseInt(amount, 10);
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
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Import grants</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bonus imports on top of tier limits — target one user or run a campaign for everyone.
            Active while within the date window; quota math applies them automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Target</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "all" | "user")}
              className="block h-9 text-sm rounded-md border border-border bg-background px-2 cursor-pointer"
            >
              <option value="user">Specific user</option>
              <option value="all">All users</option>
            </select>
          </div>
          {scope === "user" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">User email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coach@club.se" className="h-9 w-52" />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Extra imports</label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-24" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Expires (optional)</label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Season start 2026" className="h-9 w-44" />
          </div>
          <Button onClick={handleGrant} disabled={granting} className="h-9">
            {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Grant"}
          </Button>
        </div>

        {grants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-medium text-muted-foreground">Target</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground">Window</th>
                  <th className="px-2 py-2 font-medium text-muted-foreground">Reason</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-2">{g.user_email ?? <span className="font-medium">All users</span>}</td>
                    <td className="px-2 py-2 tabular-nums">+{g.amount}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {new Date(g.starts_at).toLocaleDateString("sv-SE")}
                      {" → "}
                      {g.expires_at ? new Date(g.expires_at).toLocaleDateString("sv-SE") : "no expiry"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{g.reason ?? "—"}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(g.id)}
                        className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
